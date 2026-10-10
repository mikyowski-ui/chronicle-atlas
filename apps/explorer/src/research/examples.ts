import { parseSpecification, type DashboardSpecification } from './contracts.ts';
import { PILOT_DESCRIPTOR as d } from './registry.ts';

const views=[{id:'scope',type:'summary',binding:'observations'},{id:'places',type:'map',binding:'observations'},{id:'estimates',type:'scatter',binding:'observations'},{id:'records',type:'table',binding:'observations'},{id:'sources',type:'evidence',binding:'observations'}];
function example(id:string,title:string,question:string,entityIds:string[],start:number,end:number):DashboardSpecification{
  return parseSpecification({schemaVersion:1,id,title,intent:{question,interpretation:'Inspect available UN urban-centre population estimates. Shared definitions do not establish constant city footprints.',timeWindow:{start,end},context:'explicit-entities',parentId:null},
    query:{version:1,datasetId:d.id,edition:d.edition,dataHash:d.dataHash,entityIds,timeWindow:{start,end},fields:['id','entityId','year','value','unit','locator'],sort:'entity-year',operation:'observations',joins:[],maxRows:100},
    views,interaction:'entity-observation',layout:'adaptive'});
}
export const PREPARED_EXAMPLES:readonly DashboardSpecification[]=Object.freeze([
  example('mexico-four','Four Mexican urban centres','What population estimates are available for Mexico City, Guadalajara, Monterrey and Puebla from 1975 to 2025?',
    ['hist-mexicocity-faaf2abd','hist-guadalajara-86f202e4','hist-monterrey-f375b062','hist-puebla-d4160425'],1975,2025),
  example('guadalajara-focus','Guadalajara in focus','What population estimates are available for Guadalajara from 1990 to 2025?',
    ['hist-guadalajara-86f202e4'],1990,2025),
]);
