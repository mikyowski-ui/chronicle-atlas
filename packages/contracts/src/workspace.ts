import { z } from 'zod';
import { DashboardSpecificationSchema as V1Dashboard, QueryIntentSchema, QueryPlanSchema } from './research.ts';

export const WORKSPACE_VERSIONS=Object.freeze({schema:2,renderer:'linked-evidence-2',compatibility:'prepared-v1-to-workspace-v2'} as const);
export const ViewSchema=z.strictObject({id:z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),type:z.enum(['map','scatter','interval','table','evidence','summary']),binding:z.literal('observations')});
export type ViewType=z.infer<typeof ViewSchema>['type'];
export const RENDERER_CAPABILITIES:readonly ViewType[]=['map','scatter','interval','table','evidence','summary'];
export const WorkspaceSpecificationSchema=z.strictObject({schemaVersion:z.literal(2),id:V1Dashboard.shape.id,title:V1Dashboard.shape.title,intent:QueryIntentSchema,plan:QueryPlanSchema,views:z.array(ViewSchema).min(1).max(5),selection:z.literal('entity-observation'),layout:z.literal('adaptive')});
export type WorkspaceSpecification=z.infer<typeof WorkspaceSpecificationSchema>;
export const SelectionSchema=z.strictObject({entityId:z.string().min(1).max(160),observationId:z.string().min(1).max(160)});
export type Selection=z.infer<typeof SelectionSchema>;
