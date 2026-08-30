/**
 * execute-flow.ts — U11 FLOW / SEQUENCE authority.
 *
 * ICON p.85 ("Effects resolve in the order they are listed") and p.107 §4:
 * every operation in an ordinary ordered ability sequence sees the ACTUAL
 * INTERMEDIATE STATE produced by the preceding operations ("rush, then
 * damage adjacent foe"; "remove the object, then place the user in its
 * space"; "teleport, then test adjacency"; "rush 1, then rush 1, each time
 * optionally damage"). This module is the ONE flow authority: a small
 * typed little language (`FlowNode`) executed by `executeFlow` against a
 * PURE simulated intermediate encounter state, so later flow operations
 * observe earlier mutations' results instead of the original pre-state.
 *
 * Command/event purity: planning is a pure function of the recorded input,
 * the seeded dice, and the initial state. The emitted mutation list IS the
 * durable event payload; replay consumes those recorded mutations and never
 * re-runs planning/choice/RNG logic (`applyEvents` never calls back into
 * this module). The simulation is clone-based — the live encounter is never
 * touched, no dice are consumed by simulating (dice are consumed once by
 * the operations themselves, exactly as before the flow authority existed).
 *
 * SIMULATION FIDELITY: the simulated intermediate state is the REDUCER's
 * own sequential projection of the emitted-so-far mutation list
 * (`encounter-adapter.applyRuleMutation`), recomputed from a pre-flow
 * snapshot every time a mutation is emitted. Recomputing from the snapshot
 * — instead of incrementally patching the simulation — guarantees the
 * simulation always equals what the reducer will produce for the same
 * list, including the U15 atomic-group (spatial batch) denial fixpoint:
 * a group denied late in the list can flip an earlier group's denial, and
 * the reducer judges groups against the pre-swap snapshot, never against a
 * leg-by-leg sequential application. The simulation therefore can never
 * turn a simultaneous swap into a sequential swap. The cost is O(n²) over
 * the event's mutation count, which is trivially small for a planning pass
 * on human-paced commands.
 *
 * U15 atomic groups: swap/group legs sharing a `spatialBatchId` are applied
 * to the simulation exactly as the reducer applies them — every leg or
 * none, judged against the same pre-swap snapshot with group-scoped
 * co-moved exemption. The reducer remains the authority at commit time;
 * the flow simulation only mirrors it so later reads agree.
 *
 * BOUNDARIES (documented specialists that stay OUTSIDE this authority):
 *
 * - Named per-ability RESOLVERS (`RuleAction.resolverId`) still receive the
 *   ORIGINAL context and produce their mutations at the command boundary;
 *   their emitted mutations are ABSORBED into the simulation (so later flow
 *   steps observe them), but resolvers themselves do not read the simulated
 *   view. Migrating resolver internals onto flow nodes is consumer work.
 * - COSTS are validated and emitted by the cost-payment kernel before the
 *   flow starts; their mutations are absorbed so later reads observe the
 *   paid state (ICON p.99/p.102: costs are paid at the start of an ability).
 * - Kernel reads through `context.encounterState` (recipient-scoped bonus
 *   damage dice, teleport-choice) stay LIVE-state reads; the flow sim
 *   projects the RUNTIME view (`context.state`). Migrating those reads onto
 *   the simulated view is U12/U13 consumer work.
 * - The reactive continuation fold (`executeRuleProgramWithReactiveTriggers`)
 *   re-invokes `executeRuleProgram` per pass; each pass seeds a FRESH
 *   simulation from the original encounter state. Cross-pass simulation
 *   (a triggered step observing the primary pass's outcomes) rides the
 *   recorded resolution facts and is U12 territory, not this module.
 * - `open-window` / `suspend` nodes are NOT implemented here (U13/U12);
 *   the node union is deliberately shaped so they slot in later without an
 *   ad-hoc continuation record in this module.
 *
 * No source IDs, no source-unit wiring: content rows may compose these
 * nodes, but the engine never branches on a source id here.
 */
import type { EncounterState, Position } from '../../types.js';
import { resolveAuthoritativeAttack } from './attack-resolution.js';
import { applyRuleMutation, coMovedActorIdsForMove, deniedAtomicSpatialLegIndices, encounterRuleState } from './encounter-adapter.js';
import { actor, evaluateNumber, integer, selectActors } from './evaluate-value.js';
import { evaluatePredicate } from './evaluate-predicate.js';
import { bind, EMPTY_BINDER, type Binder, type Reference } from '../primitives/reference.js';
import { resolveSaveWindow, type SaveWindowKind, type SaveWindowModifiers } from '../primitives/save-window.js';
import { resolveCureMutations } from '../primitives/status-saves.js';
import { RuleProgramViolation } from './violations.js';
import type {
  Fact,
  RuleChoice,
  RuleEffect,
  RuleExecutionContext,
  RuleMutation,
  RuleNumber,
  RulePredicate,
  RuleRuntimeState,
} from '../primitives/types.js';
import { consumeTraitAttackModifiers, consumedTraitModifier } from './attack-modifiers.js';

/**
 * One U11 flow node. The core vocabulary that can land NOW:
 *
 * - `sequence` — run sub-nodes in order against the shared simulation.
 * - `bind` — U1 reference propagation: bind a name to a reference so later
 *   operations resolve it (`CHOOSE a position AS landing`). Pure name
 *   binding; the bound reference is domain-checked at resolution time.
 * - `if` — U6 predicate gate; both branches run against the shared sim.
 * - `apply` — emit one existing `RuleEffect` (the compatibility surface;
 *   every RuleProgram/RuleStep effect routes through this node).
 * - `repeat` — U5 `times` iterations of sub-nodes; iteration N+1 observes
 *   the state iteration N produced. The count is decided once at loop
 *   entry (a plan-time decision like any other).
 * - `for-each` — deterministic iteration over an ALREADY-DERIVED
 *   CandidateSet (projected to actor references by the caller through the
 *   U3 authority — this node never re-queries). Each item is bound under
 *   `bindName` (U1) for the body; an empty set is a clean no-op.
 * - `invoke` — run a sub-flow through the SAME flow authority (shared
 *   simulation + binder). Resolving WHICH program/action an invoke names
 *   is content's job; this node is the flow-level seam U12 wires later.
 * - `emit-fact` — U10 integration: record a typed fact produced by this
 *   flow. The fact rides the flow result and the event's fact list; the
 *   boundary's global id renumbering (U12/U13 work) owns the final
 *   `instanceId` allocation when content starts emitting facts.
 * - `open-window` (U13) — suspend the flow and open a U13 decision window
 *   carrying the recorded U4 choice spec + the REMAINING flow nodes. The
 *   flow's mutations-so-far are the durable pre-window payload; the window
 *   gates the rest (FLOW → U13 window → U12 held/deferred continuation →
 *   recorded answer → resume FLOW through the same planner).
 * - `suspend` (U13) — suspend the flow at a pure resume gate (a window with
 *   no choice of its own; the answer is the recorded `resume` decision).
 *
 * The suspension carries NO ad-hoc continuation record: the remaining
 * nodes + the current binder ARE the continuation, stored on the U13 window
 * record (`DecisionWindowRecord.resume`) and re-executed by the flow
 * planner when the window is answered.
 */
export type FlowNode =
  | { kind: 'sequence'; nodes: FlowNode[] }
  | { kind: 'bind'; name: string; reference: Reference }
  | { kind: 'if'; predicate: RulePredicate; then: FlowNode[]; otherwise?: FlowNode[] }
  | { kind: 'apply'; effect: RuleEffect }
  | { kind: 'repeat'; times: RuleNumber; nodes: FlowNode[] }
  | { kind: 'for-each'; items: readonly Reference<'actor'>[]; bindName: string; nodes: FlowNode[] }
  | { kind: 'invoke'; nodes: FlowNode[] }
  | { kind: 'emit-fact'; fact: Fact }
  | { kind: 'open-window'; choice: RuleChoice; continuationPoint?: string }
  | { kind: 'suspend'; continuationPoint?: string };

/** The U13 window request a suspended flow produces: the recorded U4 choice
 * spec (absent for a pure `suspend` gate), the REMAINING flow nodes, and the
 * current U1 binder — everything the window needs to resume the flow
 * through this same authority when answered. JSON-clean and replay-safe. */
export interface FlowWindowRequest {
  /** The U4 choice spec the window offers; absent for a pure resume gate. */
  choice?: RuleChoice;
  remaining: FlowNode[];
  binder: Binder;
  /** The program/action-relative point the flow resumed from. */
  continuationPoint: string;
}

/** The result of a flow execution: the durable ordered mutations (the event
 * payload), any U10 facts emitted by `emit-fact` nodes, and — when the flow
 * suspended at an `open-window`/`suspend` node — the U13 window request
 * carrying the remaining nodes. */
export interface FlowExecution {
  mutations: RuleMutation[];
  facts: Fact[];
  window?: FlowWindowRequest | null;
}

/**
 * The U11 planner: executes flow nodes / effect lists against a pure
 * simulated intermediate encounter state.
 *
 * When the execution context carries `encounterState`, the simulation is a
 * clone of it, and every emitted mutation is applied to the simulation
 * through the reducer's own applier (recomputed from the pre-flow snapshot
 * so U15 atomic-group denial is judged exactly as the reducer judges it).
 * When no `encounterState` is present (isolated VM fixtures), the planner
 * evaluates every operation against the ORIGINAL runtime view — exactly the
 * pre-flow behavior — so VM-only consumers are behavior-preserved by
 * construction.
 */
/** One enclosing execution frame of the walk stack. A LIST frame captures
 * the rest of its node list; a LOOP frame (repeat/for-each) captures the
 * loop's UNEXECUTED iterations/items so a suspension inside a partially
 * consumed loop resumes the remaining executions, never just the innermost
 * list tail. */
type FlowWalkFrame =
  | { kind: 'list'; list: readonly FlowNode[]; index: number }
  | { kind: 'repeat'; body: readonly FlowNode[]; remainingIterations: number }
  | { kind: 'for-each'; items: readonly Reference<'actor'>[]; bindName: string; body: readonly FlowNode[]; remainingItems: readonly Reference<'actor'>[] };

export class FlowPlanner {
  private readonly base: RuleExecutionContext;
  private readonly simBase: EncounterState | null;
  private simEncounter: EncounterState | null;
  private simView: RuleRuntimeState;
  private binder: Binder;
  readonly mutations: RuleMutation[] = [];
  readonly facts: Fact[] = [];
  /** The U13 window request once the flow suspends; null while unsuspended. */
  window: FlowWindowRequest | null = null;
  /** The enclosing execution frames currently being walked (for remaining-
   * computation capture when a nested node suspends). A LIST frame captures
   * the rest of its node list; a LOOP frame (repeat/for-each) captures the
   * loop's UNEXECUTED iterations/items — a suspension inside a partially
   * consumed loop must resume the remaining executions, never just the
   * innermost list tail. */
  private readonly stack: FlowWalkFrame[] = [];

  constructor(context: RuleExecutionContext) {
    this.base = context;
    this.binder = context.boundNames ?? EMPTY_BINDER;
    this.simEncounter = context.encounterState ? structuredClone(context.encounterState) : null;
    // The pre-flow snapshot the simulation is recomputed from, so atomic
    // spatial groups are judged against the SAME snapshot the reducer uses
    // (never against a leg-by-leg sequential application).
    this.simBase = this.simEncounter ? structuredClone(this.simEncounter) : null;
    this.simView = this.simEncounter ? encounterRuleState(this.simEncounter) : context.state;
  }

  /** The context each operation evaluates against: the CURRENT simulated
   * runtime view plus the CURRENT binder. `encounterState` stays the LIVE
   * state (documented boundary — kernel reads through that slot remain
   * live-state reads until U12/U13 migrate them). */
  private opContext(extra?: Partial<RuleExecutionContext>): RuleExecutionContext {
    return { ...this.base, state: this.simView, boundNames: this.binder, ...extra };
  }

  /** Recompute the simulation from the pre-flow snapshot over the emitted
   * mutation list, applying the reducer's exact sequential projection
   * (atomic-group denial + group-scoped co-moved exemption included). */
  private refreshSimulation(): void {
    if (!this.simEncounter) return;
    const full = this.mutations;
    const denied = deniedAtomicSpatialLegIndices(this.simBase!, full);
    this.simEncounter = structuredClone(this.simBase!);
    for (let index = 0; index < full.length; index += 1) {
      if (denied.has(index)) continue;
      const mutation = full[index];
      applyRuleMutation(this.simEncounter, mutation, index, mutation.kind === 'move' ? coMovedActorIdsForMove(full, mutation) : undefined);
    }
    this.simView = encounterRuleState(this.simEncounter);
  }

  /** Emit one durable mutation and apply it to the simulation (a no-op for
   * contexts without encounter state). */
  emit(mutation: RuleMutation): void {
    this.mutations.push(mutation);
    this.refreshSimulation();
  }

  /** Absorb already-emitted mutations (costs, named-resolver output) into
   * the durable list AND the simulation, so later flow operations observe
   * them in order. */
  absorb(mutations: readonly RuleMutation[]): void {
    for (const mutation of mutations) this.emit(mutation);
  }

  /** Whether the flow has suspended (no further nodes execute). */
  get suspended(): boolean {
    return this.window !== null;
  }

  /** Run one flow node. */
  node(node: FlowNode): void {
    if (this.suspended) return;
    switch (node.kind) {
      case 'sequence':
      case 'invoke':
        this.nodes(node.nodes);
        break;
      case 'bind':
        this.binder = bind(this.binder, node.name, node.reference);
        break;
      case 'if':
        this.nodes(evaluatePredicate(node.predicate, this.opContext()) ? node.then : node.otherwise ?? []);
        break;
      case 'apply':
        this.effects([node.effect], this.opContext());
        break;
      case 'repeat': {
        // The iteration count is decided ONCE at loop entry (a plan-time
        // decision, like any other recorded choice).
        const times = integer(node.times, this.opContext());
        if (times <= 0) break;
        // The loop frames itself so a suspension inside an iteration captures
        // the UNEXECUTED iterations (not just the innermost list tail).
        const loopFrame: Extract<FlowWalkFrame, { kind: 'repeat' }> = {
          kind: 'repeat',
          body: node.nodes,
          remainingIterations: times,
        };
        const bodyFrame: Extract<FlowWalkFrame, { kind: 'list' }> = { kind: 'list', list: node.nodes, index: -1 };
        this.stack.push(loopFrame, bodyFrame);
        try {
          for (let iteration = 0; iteration < times && !this.suspended; iteration += 1) {
            loopFrame.remainingIterations = times - 1 - iteration;
            bodyFrame.index = -1;
            for (let index = 0; index < node.nodes.length && !this.suspended; index += 1) {
              bodyFrame.index = index;
              this.node(node.nodes[index]!);
            }
          }
        } finally {
          this.stack.pop();
          this.stack.pop();
        }
        break;
      }
      case 'for-each': {
        // Iterate an ALREADY-DERIVED CandidateSet deterministically: the
        // caller projected the set to references through the U3 authority;
        // this node never re-queries. Each item is bound (U1) for the body.
        // The loop frames itself so a suspension inside an item captures the
        // REMAINING items (each re-bound) — not just the innermost tail.
        const loopFrame: Extract<FlowWalkFrame, { kind: 'for-each' }> = {
          kind: 'for-each',
          items: node.items,
          bindName: node.bindName,
          body: node.nodes,
          remainingItems: node.items.slice(1),
        };
        const bodyFrame: Extract<FlowWalkFrame, { kind: 'list' }> = { kind: 'list', list: node.nodes, index: -1 };
        this.stack.push(loopFrame, bodyFrame);
        try {
          for (let iteration = 0; iteration < node.items.length && !this.suspended; iteration += 1) {
            const item = node.items[iteration]!;
            loopFrame.remainingItems = node.items.slice(iteration + 1);
            this.binder = bind(this.binder, node.bindName, item);
            bodyFrame.index = -1;
            for (let index = 0; index < node.nodes.length && !this.suspended; index += 1) {
              bodyFrame.index = index;
              this.node(node.nodes[index]!);
            }
          }
        } finally {
          this.stack.pop();
          this.stack.pop();
        }
        break;
      }
      case 'emit-fact':
        this.facts.push(node.fact);
        break;
      case 'open-window':
      case 'suspend':
        this.suspendAt(node.kind === 'open-window' ? node.choice : undefined, node.continuationPoint);
        break;
    }
  }

  /** Suspend the flow at the current point: capture the ENTIRE un-executed
   * execution from the walk stack — the rest of the current list, PLUS every
   * enclosing loop's unexecuted iterations/items (each re-bound for
   * for-each), PLUS the remaining parts of every enclosing list — never just
   * the innermost tail. The loop remainders compose EXISTING nodes
   * (`sequence`/`bind`), so the resume re-enters the SAME flow authority
   * with no new node vocabulary. Record the window request and stop. */
  private suspendAt(choice: RuleChoice | undefined, continuationPoint?: string): void {
    const remaining: FlowNode[] = [];
    // Frames are pushed outer→inner; execution resumes inner→outer (finish
    // the innermost list, then its enclosing loop's remaining iterations,
    // then the enclosing list, and so on) — exactly the walk order below.
    for (let frame = this.stack.length - 1; frame >= 0; frame -= 1) {
      const current = this.stack[frame]!;
      switch (current.kind) {
        case 'list':
          remaining.push(...current.list.slice(current.index + 1));
          break;
        case 'repeat':
          // Every UNEXECUTED iteration of the loop body, as ordered
          // sequences — the loop's count was decided once at entry, so the
          // number of remaining executions is exact.
          for (let iteration = 0; iteration < current.remainingIterations; iteration += 1) {
            remaining.push({ kind: 'sequence', nodes: [...current.body] });
          }
          break;
        case 'for-each':
          // Every REMAINING item, each re-bound (U1) before its body runs.
          for (const item of current.remainingItems) {
            remaining.push({ kind: 'bind', name: current.bindName, reference: item });
            remaining.push({ kind: 'sequence', nodes: [...current.body] });
          }
          break;
      }
    }
    this.window = {
      ...(choice !== undefined ? { choice } : {}),
      remaining,
      binder: this.binder,
      continuationPoint: continuationPoint ?? 'suspended',
    };
  }

  /** Run an ordered list of flow nodes against the shared simulation. Each
   * list frames itself on the walk stack so a suspension inside a nested
   * list captures the whole remaining execution. */
  nodes(nodes: readonly FlowNode[]): void {
    if (this.suspended) return;
    const frame: Extract<FlowWalkFrame, { kind: 'list' }> = { kind: 'list', list: nodes, index: -1 };
    this.stack.push(frame);
    try {
      for (let index = 0; index < nodes.length && !this.suspended; index += 1) {
        frame.index = index;
        this.node(nodes[index]!);
      }
    } finally {
      this.stack.pop();
    }
  }

  /** Run one ordered list of existing `RuleEffect`s (the RuleProgram/RuleStep
   * compatibility surface) against the shared simulation — every effect
   * observes the state the preceding effects produced. `extra` carries the
   * per-branch context overrides (action tags, branch target ids, delivery);
   * the evaluation context ALWAYS reads the simulated view, never a
   * caller-supplied stale view. */
  effects(effects: readonly RuleEffect[], extra?: Partial<RuleExecutionContext>): void {
    for (const effect of effects) {
      // Each effect re-reads the CURRENT simulated view: an earlier effect in
      // this list just emitted mutations that refreshed the simulation, so a
      // context captured once at the top would be stale (it would point at the
      // pre-list view object). The evaluation context is therefore rebuilt per
      // effect — later effects always observe the state earlier ones produced.
      const context = this.opContext(extra);
      const targets = 'target' in effect ? selectActors(effect.target, context) : [];
      switch (effect.kind) {
        case 'resolution-targets': {
          const ids = effect.outcome === 'attack-targets'
            ? (context.attackTargetId ? [context.attackTargetId] : [])
            : effect.outcome === 'collided'
              ? (context.resolutionFacts?.collidedActorIds ?? [])
              : (context.resolutionFacts?.slainActorIds ?? []);
          for (const id of ids) this.effects(effect.effects, { triggerTargetIds: [...ids] });
          break;
        }
        case 'attack': {
          const source = actor(context, context.actorId);
          for (const target of targets) {
            // The unified ordinary-attack authority folds the F6 trait
            // modifiers, the aura attacker boons/curses plus the target's
            // defensive aura curse, the F10 ability-use modifiers for this
            // ability only, and unerring — the same seam every named
            // resolver and foe recipe attack uses. Reads the SIMULATED
            // view, so a pre-rush/teleport attack observes the post-move
            // target/attacker state.
            const attack = resolveAuthoritativeAttack(context, source, target, {
              boons: effect.boons ? Math.trunc(evaluateNumber(effect.boons, context)) : 0,
              trueStrike: effect.trueStrike ?? false,
              autoHit: effect.autoHit ?? false,
            });
            const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit } = attack;
            this.emit(attack.attackMutation);
            const triggers = new Set(context.triggers);
            triggers.add(hit ? 'hit' : 'miss');
            if (critical) triggers.add('critical-hit');
            if (attack.attackMutation.kind === 'attack' && attack.attackMutation.exceed === true) triggers.add('exceed');
            // p.89/p.104/p.105 exceptions belong only to this resolved
            // attack's direct target, not collateral area or later effect
            // damage.
            const branchExtra: Partial<RuleExecutionContext> = {
              attackTargetId: target.id,
              triggerTargetIds: [target.id],
              triggers,
              delivery: hit ? 'hit' as const : 'miss' as const,
              attackDamageProvenance: { targetId: target.id, ...attack.damageProvenance },
            };
            this.effects(hit ? effect.onHit : effect.onMiss, branchExtra);
            if (critical) this.effects(effect.onCritical ?? [], branchExtra);
            // One-shot armed modifiers belong to the first attack roll only: a
            // multi-target ability's later rolls read the (consumed) view.
            if (consumedTraitModifier(attack.traitModifier)) consumeTraitAttackModifiers(source.state);
          }
          break;
        }
        case 'damage': {
          const instances = effect.instances ? integer(effect.instances, context) : 1;
          for (const target of targets) for (let instance = 1; instance <= instances; instance += 1) {
            const attackDamage = context.attackDamageProvenance?.targetId === target.id ? context.attackDamageProvenance : undefined;
            const unerring = Boolean(context.actionTags?.has('unerring') || attackDamage?.ignoreAetherwall || attackDamage?.ignoreCover);
            const ignoreCover = Boolean(effect.ignoreCover || context.actionTags?.has('unerring') || attackDamage?.ignoreCover);
            // F10 ability-use pierce (Blessing of Rebirth): route the damage
            // through the existing piercing damage path instead of re-deriving
            // armor/vigor handling locally.
            const damageType = context.abilityUseModifiers?.pierce && effect.damageType === 'normal' ? 'piercing' : effect.damageType;
            // The amount expression evaluates per target with the RECIPIENT
            // threaded, so recipient-scoped bonus-damage rolls (Finesse, p.116)
            // distinguish each target's live state at the roll query point.
            const recipientContext = { ...context, damageRecipientId: target.id };
            this.emit({
              kind: 'damage', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id,
              // The attack's direct-target damage instance also carries trait flat
              // bonus damage (Pulverize +2), scoped by the recorded provenance.
              amount: integer(effect.amount, recipientContext) + (attackDamage?.bonusFlat ?? 0), damageType, instance,
              delivery: effect.delivery ?? context.delivery ?? 'effect', ignoreCover,
              ...(attackDamage?.ignoreDodge ? { ignoreDodge: true } : {}),
              ...(unerring ? { ignoreAetherwall: true } : {}),
            });
          }
          break;
        }
        case 'heal': for (const target of targets) this.emit({ kind: 'heal', sourceId: context.sourceId, actorId: target.id, amount: integer(effect.amount, context), maximum: effect.maximum ? integer(effect.maximum, context) : null }); break;
        case 'vigor': for (const target of targets) this.emit({ kind: 'vigor', sourceId: context.sourceId, actorId: target.id, amount: integer(effect.amount, context), uncapped: effect.uncapped ?? false }); break;
        case 'condition': for (const target of targets) this.emit({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, conditionId: effect.conditionId, operation: effect.operation, potency: effect.potency ?? 'normal', ...(effect.duration ? { duration: effect.duration } : {}) }); break;
        case 'cure': for (const target of targets) for (const mutation of resolveCureMutations(context, target, effect.all ?? false)) this.emit(mutation); break;
        case 'move': {
          const positions = effect.positionInput ? [...(context.input.positions?.[effect.positionInput] ?? [])] : [];
          const direction = effect.directionInput ? context.input.directions?.[effect.directionInput] ?? null : null;
          for (const target of targets) this.emit({ kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, movement: effect.movement, distance: effect.distance ? integer(effect.distance, context) : null, positions, direction, phasing: effect.phasing ?? false });
          break;
        }
        case 'resource': for (const target of targets) this.emit({ kind: 'resource', sourceId: context.sourceId, actorId: target.id, resourceId: effect.resourceId, operation: effect.operation, amount: integer(effect.amount, context), minimum: effect.minimum ?? null, maximum: effect.maximum ?? null }); break;
        case 'actions': for (const target of targets) this.emit({ kind: 'actions', sourceId: context.sourceId, actorId: target.id, operation: effect.operation, amount: integer(effect.amount, context) }); break;
        case 'terrain': {
          const positions = effect.positionInput === 'target-position' && context.attackTargetId
            ? [actor(context, context.attackTargetId).position].filter((position): position is NonNullable<typeof position> => position !== null)
            : [...(context.input.positions?.[effect.positionInput] ?? [])];
          const count = effect.count ? integer(effect.count, context) : positions.length;
          if (positions.length < count) throw new RuleProgramViolation('choice.position-count', `${effect.positionInput} requires ${count} positions.`);
          this.emit({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: context.actorId, operation: effect.operation, terrain: effect.terrain, positions: positions.slice(0, count), height: effect.height ? integer(effect.height, context) : null, ...(effect.duration ? { duration: effect.duration } : {}) });
          break;
        }
        case 'entity': {
          const owners = selectActors(effect.owner, context);
          const positions = effect.positionInput ? [...(context.input.positions?.[effect.positionInput] ?? [])] : [];
          const count = effect.count ? integer(effect.count, context) : Math.max(1, positions.length);
          // ICON general rule: creation requires free, unobstructed, and LoS.
          // The origin and maxRange are source-declared on the effect as ONE
          // creation-spatial contract (origin/range are a paired invariant — a
          // range without an origin is unrepresentable and rejected here even
          // if it were supplied); evaluated at command time and carried through
          // to the reducer for authoritative replay-safe enforcement.
          // Fail-closed: a declared origin selector must resolve to EXACTLY ONE
          // actor with a valid battlefield position. Zero actors, more than one
          // actor, or an actor without a valid on-board position mean the source
          // rule cannot determine where to create — the engine must reject, not
          // silently skip LoS/range enforcement.
          let creationSpatial: { origin: Position; originSize: number; maxRange?: number } | undefined;
          if (effect.spatial) {
            if (!effect.spatial.origin) {
              throw new RuleProgramViolation('entity.origin-required', 'Entity creation declares a maximum range but no origin; creation origin/range must travel as a pair.');
            }
            const originActors = selectActors(effect.spatial.origin, context);
            if (originActors.length !== 1 || !originActors[0].position) {
              throw new RuleProgramViolation('entity.origin-invalid', `Entity creation origin selector resolved to ${originActors.length} actor(s); expected exactly one with a valid position.`);
            }
            creationSpatial = {
              origin: originActors[0].position,
              originSize: effect.spatial.originSize ? integer(effect.spatial.originSize, context) : originActors[0].size,
              ...(effect.spatial.maxRange !== undefined ? { maxRange: effect.spatial.maxRange } : {}),
            };
          }
          for (const owner of owners) this.emit({ kind: 'entity', sourceId: context.sourceId, operation: effect.operation, entityType: effect.entityType, ownerId: owner.id, positions: positions.slice(0, count), count, state: effect.state ?? {}, ...(effect.duration ? { duration: effect.duration } : {}), ...(creationSpatial ? { creationSpatial } : {}) });
          break;
        }
        case 'mark': for (const target of targets) this.emit({ kind: 'mark', sourceId: context.sourceId, ownerId: context.actorId, operation: effect.operation, actorId: target.id, markId: effect.markId, ...(effect.duration ? { duration: effect.duration } : {}), state: effect.state ?? {} }); break;
        case 'stance': for (const target of targets) this.emit({ kind: 'stance', sourceId: context.sourceId, sourceActorId: context.actorId, operation: effect.operation, actorId: target.id, stanceId: effect.stanceId, state: effect.state ?? {} }); break;
        case 'persistent': for (const target of targets) this.emit({ kind: 'persistent', sourceId: context.sourceId, ownerId: context.actorId, operation: effect.operation, actorId: target.id, effectId: effect.effectId, duration: effect.duration, modifiers: effect.modifiers ?? [], triggers: effect.triggers ?? [], state: effect.state ?? {} }); break;
        case 'modifier': for (const target of targets) this.emit({ kind: 'modifier', sourceId: context.sourceId, ownerId: context.actorId, actorId: target.id, modifier: effect.modifier, duration: effect.duration }); break;
        case 'save': {
          for (const target of targets) {
            const sourceModifier = effect.boon ? Math.trunc(evaluateNumber(effect.boon, context)) : 0;
            const ordinal = this.mutations.filter((mutation) => mutation.kind === 'save').length + 1;
            const save = resolveSaveWindow(context, target, {
              id: `${context.sourceId}:${context.actionId}:effect-save:${ordinal}:${target.id}`,
              kind: 'effect',
              sourceId: context.sourceId,
              actorId: context.actorId,
              sourceModifier,
              // The save effect's continuation rides the record as a branch so a
              // save-reroll interrupt (Sucker Punch, p.143) can regenerate either
              // outcome; the resolver fills in the evaluated `boon`/`threshold`.
              branch: { onSuccess: effect.onSuccess, onFailure: effect.onFailure },
            }).mutation;
            this.emit(save);
            this.effects(save.success ? effect.onSuccess : effect.onFailure, { triggerTargetIds: [target.id], delivery: save.success ? 'save-success' : 'effect' });
          }
          break;
        }
        case 'if': this.effects(evaluatePredicate(effect.predicate, context) ? effect.then : effect.otherwise ?? []); break;
        case 'repeat': for (let iteration = 0; iteration < integer(effect.times, context); iteration += 1) this.effects(effect.effects); break;
        case 'defeat': for (const target of targets) this.emit({ kind: 'defeat', sourceId: context.sourceId, actorId: target.id }); break;
        case 'phase': for (const target of targets) this.emit({ kind: 'phase', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, phaseId: effect.phaseId }); break;
        case 'end-turn': for (const target of targets) this.emit({ kind: 'end-turn', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id }); break;
        case 'state': for (const target of targets) this.emit({ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, key: effect.key, operation: effect.operation, ...(effect.value !== undefined ? { value: effect.value } : {}) }); break;
      }
    }
  }
}

/** Execute an ordered list of U11 flow nodes against a pure simulated
 * intermediate state. `preEmitted` mutations (costs, resolver output) are
 * absorbed FIRST so subsequent nodes observe them in order. Pure: the
 * returned mutation list is the durable event payload; replay consumes it
 * and never re-runs this planning logic. */
export function executeFlow(
  nodes: readonly FlowNode[],
  context: RuleExecutionContext,
  options: { preEmitted?: readonly RuleMutation[] } = {},
): FlowExecution {
  const planner = new FlowPlanner(context);
  if (options.preEmitted) planner.absorb(options.preEmitted);
  planner.nodes(nodes);
  return {
    mutations: planner.mutations,
    facts: planner.facts,
    ...(planner.window !== null ? { window: planner.window } : {}),
  };
}

/** Resume a suspended flow: re-run the REMAINING nodes through the SAME
 * flow authority against THEN-CURRENT state, with the recorded U1 binder
 * restored and the recorded decision available through the context input
 * (the U4 choice surface). The resumed mutations are the new durable event
 * payload — replay consumes them and never re-plans. The resumed flow may
 * itself suspend again (nested windows) or complete; the returned window
 * request, when present, is the next suspension. */
export function executeFlowResume(
  resume: { remaining: FlowNode[]; binder: Binder },
  context: RuleExecutionContext,
  options: { decision?: { key: string; value: string | number | boolean | readonly string[] }; preEmitted?: readonly RuleMutation[] } = {},
): FlowExecution {
  // The recorded U4 decision rides the input surface under the choice key
  // (the same seam every other recorded choice consumes — booleans for
  // boolean choices, options for option choices, etc.).
  let input = context.input;
  if (options.decision) {
    const key = options.decision.key;
    const value = options.decision.value;
    if (typeof value === 'boolean') input = { ...input, booleans: { ...(input.booleans ?? {}), [key]: value } };
    else if (typeof value === 'number') input = { ...input, numbers: { ...(input.numbers ?? {}), [key]: value } };
    else if (typeof value === 'string') input = { ...input, options: { ...(input.options ?? {}), [key]: value } };
    else {
      // T6.2: a recorded ORDERING decision (the ordered candidate id list)
      // never resumes a suspended flow — an ordering window gates the U17
      // pop/projection, not a flow. Reject rather than misroute the ids into
      // a scalar bucket.
      throw new Error('flow.resume: an ordering decision cannot resume a suspended flow.');
    }
  }
  // Re-run the remaining nodes through the SAME flow authority against
  // THEN-CURRENT state, with the recorded binder restored and the recorded
  // decision on the input surface. The simulation clones state, so the
  // augmented context is safe to pass at construction.
  const planner = new FlowPlanner({ ...context, boundNames: resume.binder, input });
  if (options.preEmitted) planner.absorb(options.preEmitted);
  planner.nodes(resume.remaining);
  return {
    mutations: planner.mutations,
    facts: planner.facts,
    ...(planner.window !== null ? { window: planner.window } : {}),
  };
}

/** The reducer-facing projection of the same plan: emit a list of existing
 * `RuleEffect`s as ordered mutations against the simulated intermediate
 * state and append them to `output` (the compatibility surface the save
 * reroll path and migration code use). With no `encounterState` on the
 * context this is exactly the historical per-effect emission against the
 * original view. */
export function effectsToMutations(effects: readonly RuleEffect[], context: RuleExecutionContext, output: RuleMutation[]): void {
  const planner = new FlowPlanner(context);
  planner.effects(effects, context);
  output.push(...planner.mutations);
}
