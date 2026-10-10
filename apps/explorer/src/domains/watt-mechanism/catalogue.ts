import { specForMechanism as sharedSpecification, defaultMechanismViews, type MechanismRegistration } from '@chronicle/runtime/mechanism';
export * from '@chronicle/runtime/mechanism';
export function specForMechanism(registration: MechanismRegistration, views = defaultMechanismViews()) {
  return sharedSpecification(registration, views, 'watt-separate-condenser-workspace');
}
