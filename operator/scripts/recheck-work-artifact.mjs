import assert from 'node:assert/strict';
import {readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {projectRoot} from '../dist/config.js';

// Regrade only the retained synthetic paging false-negative; do not rerun the
// model, rewrite its failed evidence, or inspect unrelated user documents.
const reportPath=realpathSync(process.argv[2]),artifactPath=realpathSync(process.argv[3]);
assert(reportPath.startsWith(path.join(projectRoot,'logs')+path.sep));
assert(artifactPath.startsWith(path.join(projectRoot,'runtime/operator-artifacts')+path.sep));
const original=JSON.parse(readFileSync(reportPath,'utf8'));assert.equal(original.synthetic,true);
const item=original.cases.find(value=>value.name==='useful-Medical-readiness-report');assert(item);
assert(item.assertion?.includes("text.includes('10.0.302')"),'Only the known incomplete-preview assertion is eligible');
assert(item.observations.some(value=>value.tool==='jarvis_sportmedical'&&value.observation.ok));
assert(item.observations.some(value=>value.tool==='jarvis_projects'&&value.observation.result?.data?.source==='medical/backend/global.json'));
const artifact=item.observations.find(value=>value.tool==='jarvis_document_create'&&value.observation.status==='succeeded'&&value.observation.result.data.format==='md').observation.result.data;
assert(artifactPath.endsWith(path.sep+artifact.relative.split('/').join(path.sep)));
const bytes=readFileSync(artifactPath),hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,artifact.sha256);
const text=bytes.toString('utf8');assert(text.includes('10.0.302'));assert(/offline|unreachable|not connected|unavailable/i.test(text));
const result={verified:true,originalReport:reportPath,originalPassed:original.passed,correctedPassed:original.cases.filter(value=>value.passed||value===item).length,total:original.total,
  correction:'The verifier checked only30 lines after paging became line-count based. The SDK starts on line31. The complete unchanged artifact satisfies the original requirements.',
  artifact:artifact.name,sha256:hash,sourceReadVerified:true,clinicProbeVerified:true,completeArtifactVerified:true};
const output=path.join(path.dirname(reportPath),'artifact-recheck.json');writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:output},null,2));
