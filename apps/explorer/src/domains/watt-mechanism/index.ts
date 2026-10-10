/** Public surface of the non-map Watt mechanism domain. */
export * from './contracts.ts';
export {
  MechanismError, compileMechanismPlan, defaultMechanismViews, exportMechanismReplay, isMechanismReplay, preflightMechanismReplay,
  registerMechanism, resolveMechanism, resolveMechanismSelection, restoreMechanismReplay, specForMechanism, validateMechanismSpecification,
  type MechanismBundle, type MechanismRegistration, type ResolvedMechanismSelection,
} from './catalogue.ts';
export { MechanismEngine, WATT_DATASET_ID, WATT_PINS, createWattLoader, type MechanismLoader, type MechanismResult } from './engine.ts';
