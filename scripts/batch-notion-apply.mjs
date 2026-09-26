#!/usr/bin/env node

/**
 * scripts/batch-notion-apply.mjs
 * Iterates through pending jobs in data/notion-pending.json using apply-job.mjs.
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const pendingFile = join(process.cwd(), 'data/notion-pending.json');

if (!existsSync(pendingFile)) {
  console.error(`Error: No se encontró ${pendingFile}`);
  process.exit(1);
}

const jobs = JSON.parse(readFileSync(pendingFile, 'utf-8'));
console.log(`\nCargadas ${jobs.length} ofertas pendientes de postulación.`);

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  if (!job.Enlace) continue;

  console.log(`\n======================================================================`);
  console.log(`[${i + 1}/${jobs.length}] ${job.Empresa || 'Empresa'} — ${job.Cargo || 'Cargo'} (Encaje: ${job.Encaje || 'N/A'})`);
  console.log(`[Enlace] ${job.Enlace}`);
  console.log(`======================================================================`);

  const child = spawnSync('node', [join(process.cwd(), 'scripts/apply-job.mjs'), job.Enlace], {
    stdio: 'inherit',
    encoding: 'utf-8'
  });

  if (child.status === 2) {
    console.log(`[Resultado] Vacante cerrada/expirada.`);
    job._status = 'closed';
  } else if (child.status === 0) {
    console.log(`[Resultado] Postulación enviada con éxito.`);
    job._status = 'submitted';
  } else {
    console.log(`[Resultado] No procesada (código ${child.status}).`);
    job._status = 'skipped';
  }

  // Update notion-pending.json with progress
  writeFileSync(pendingFile, JSON.stringify(jobs, null, 2), 'utf-8');
}

console.log(`\n¡Lote finalizado!`);
