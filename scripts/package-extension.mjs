import { readFile, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'browser-extension');
const files = ['manifest.json','features.js','background.js','bridge.js','guards.js','signup.js','signup-fields.js','signup-runner.js','signup-runner.html','signup-ui.js','plan.js','session.js','instagram.js','tiktok.js','runner.js','runner.html','sidepanel.html','dashboard.js','dashboard.css','inter.woff2','INTER-LICENSE.txt','icon-16.png','icon-32.png','icon-48.png','icon-128.png'];
await copyFile(path.join(root,'dashboard.js'),path.join(extension,'dashboard.js'));
await copyFile(path.join(root,'signup-ui.js'),path.join(extension,'signup-ui.js'));
await copyFile(path.join(root,'plan.js'),path.join(extension,'plan.js'));
const origin = 'https://creator-collective-warmup.vercel.app';
let panel = (await readFile(path.join(root,'index.html'),'utf8'))
  .replace('<body>', '<body class="side-panel">')
  .replace(/href="(\/|setup\.html|privacy\.html)"/g, (_, value) => `href="${origin}/${value === '/' ? '' : value}" target="_blank" rel="noopener"`);
await writeFile(path.join(extension,'sidepanel.html'), panel);
await copyFile(path.join(root,'dashboard.css'),path.join(extension,'dashboard.css'));
await copyFile(path.join(root,'INTER-LICENSE.txt'),path.join(extension,'INTER-LICENSE.txt'));
const manifest = JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
const staging = await mkdtemp(path.join(tmpdir(),'cc-extension-'));
try {
  const folder = path.join(staging,'creator-collective-extension');
  await mkdir(folder);
  for (const name of files) await copyFile(path.join(extension,name),path.join(folder,name));
  const output = path.join(root,`creator-collective-extension-${manifest.version}.zip`);
  await rm(output,{force:true});
  execFileSync('/usr/bin/zip',['-q','-r',output,'creator-collective-extension'],{cwd:staging});
  const storeOutput = path.join(root,'store',`chrome-web-store-${manifest.version}.zip`);
  await rm(storeOutput,{force:true});
  execFileSync('/usr/bin/zip',['-q',storeOutput,...files],{cwd:folder});
  await writeFile(path.join(root,'store','build-manifest.json'),JSON.stringify({version:manifest.version,files},null,2)+'\n');
  console.log(`packaged ${files.length} explicit files for beta installation and store upload`);
} finally { await rm(staging,{recursive:true,force:true}); }
