#!/usr/bin/env node

/**
 * scripts/scan-junior-portals.mjs
 * Comprehensive, unattended Junior Job Scanner for Chile & Remote LATAM.
 * Uses visible Camoufox to scrape live postings across:
 * - LinkedIn Jobs (Chile Easy Apply)
 * - Get on Board (Junior tags & queries)
 * - FirstJob (Chile entry-level & trainee)
 * - Computrabajo (Junior informática & desarrollo)
 * - Chiletrabajos (Junior software & devops)
 * 
 * Filters:
 * - Strictly excludes Senior, Semi-Senior, Sr, Lead, Staff, Principal, Manager, 3+ years.
 * - Deduplicates against data/pipeline.md, data/applications.md, data/scan-history.tsv.
 * - Appends new verified offers directly to data/pipeline.md.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runCamoufox(cmd, ...args) {
  try {
    const stdout = execFileSync('camoufox-browser', [cmd, ...args], {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return stdout ? stdout.trim() : '';
  } catch (err) {
    console.error(`[Camoufox error] ${cmd}: ${err.message}`);
    return '';
  }
}

function evaluate(jsCode) {
  return runCamoufox('evaluate', jsCode);
}

// Load existing URLs for dedup
const existingUrls = new Set();

function loadDedup() {
  const files = ['data/pipeline.md', 'data/applications.md', 'data/scan-history.tsv'];
  for (const f of files) {
    const p = join(process.cwd(), f);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');
    const matches = content.match(/https?:\/\/[^\s\)\|\,\'\"]+/g) || [];
    for (const m of matches) {
      existingUrls.add(cleanUrl(m));
    }
  }
  console.log(`[Dedup] Cargadas ${existingUrls.size} URLs existentes en historial.`);
}

function cleanUrl(u) {
  try {
    const urlObj = new URL(u);
    // Strip tracking params
    urlObj.searchParams.delete('ref');
    urlObj.searchParams.delete('trackingId');
    urlObj.searchParams.delete('currentJobId');
    urlObj.searchParams.delete('utm_source');
    urlObj.searchParams.delete('utm_medium');
    urlObj.searchParams.delete('utm_campaign');
    return urlObj.origin + urlObj.pathname;
  } catch {
    return u.split('?')[0].trim();
  }
}

const NEGATIVE_KEYWORDS = [
  'senior', 'sr.', 'sr ', '(sr)', 'lead', 'principal', 'staff',
  'semi senior', 'semi-senior', 'semisenior', 'ssr', 'manager',
  'director', 'head', 'jefe', 'gerente', 'architect', 'arquitecto',
  '3+ años', '4+ años', '5+ años', '3 a 5 años', '3-5 años', '3+ years', '5+ years'
];

function isTitleExcluded(title) {
  const t = title.toLowerCase();
  for (const neg of NEGATIVE_KEYWORDS) {
    if (t.includes(neg)) return true;
  }
  return false;
}

const foundJobs = [];

async function scanLinkedIn(query, label) {
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Chile&f_AL=true`;
  console.log(`\n🔍 [LinkedIn] Escaneando: ${label}...`);
  runCamoufox('open', searchUrl);
  await sleep(4000);

  // Scroll to load more cards
  evaluate(`() => {
    const container = document.querySelector('.jobs-search__results-list, .scaffold-layout__list-container, main');
    if (container) container.scrollBy(0, 800);
  }`);
  await sleep(1500);

  const rawJobs = evaluate(`() => {
    const items = Array.from(document.querySelectorAll('.jobs-search-results__list-item, .job-card-container, [data-occludable-job-id]')).map(el => {
      const titleEl = el.querySelector('a.job-card-list__title--link, a.job-card-container__link, .base-search-card__title, h3, h4');
      const companyEl = el.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .base-search-card__subtitle');
      const locationEl = el.querySelector('.artdeco-entity-lockup__caption, .job-card-container__metadata-item');
      const linkEl = el.querySelector('a[href*=\"/jobs/view/\"]');
      
      return {
        title: titleEl ? titleEl.innerText.trim() : '',
        company: companyEl ? companyEl.innerText.trim() : '',
        location: locationEl ? locationEl.innerText.trim() : 'Chile',
        url: linkEl ? linkEl.href : ''
      };
    }).filter(j => j.title && j.url);
    return JSON.stringify(items);
  }`);

  try {
    const items = JSON.parse(rawJobs);
    for (const j of items) {
      const clean = cleanUrl(j.url);
      if (!existingUrls.has(clean) && !isTitleExcluded(j.title)) {
        existingUrls.add(clean);
        foundJobs.push({ ...j, url: clean, portal: 'LinkedIn' });
        console.log(`  ✨ [LinkedIn] + ${j.company} — ${j.title}`);
      }
    }
  } catch (e) {
    console.error(`  [LinkedIn Error] ${e.message}`);
  }
}

async function scanGetOnBoard(query, category) {
  const searchUrl = `https://www.getonbrd.com/jobs/${category}?q=${encodeURIComponent(query)}`;
  console.log(`\n🔍 [Get on Board] Escaneando (${category}): "${query}"...`);
  runCamoufox('open', searchUrl);
  await sleep(3500);

  const rawJobs = evaluate(`() => {
    const links = Array.from(document.querySelectorAll('a[href*=\"/jobs/\"]')).filter(a => {
      const t = a.innerText.toLowerCase();
      return t.includes('junior') || t.includes('trainee') || t.includes('sin experiencia') || t.includes('entry');
    }).map(a => {
      const text = a.innerText.trim().replace(/\\n+/g, ' | ');
      const parts = text.split(' | ');
      return {
        title: parts[0] || 'Junior Role',
        company: parts[1] || 'Empresa',
        location: parts[2] || 'Chile / Remote',
        url: a.href
      };
    });
    return JSON.stringify(links);
  }`);

  try {
    const items = JSON.parse(rawJobs);
    for (const j of items) {
      const clean = cleanUrl(j.url);
      if (!existingUrls.has(clean) && !isTitleExcluded(j.title)) {
        existingUrls.add(clean);
        foundJobs.push({ ...j, url: clean, portal: 'Get on Board' });
        console.log(`  ✨ [Get on Board] + ${j.company} — ${j.title}`);
      }
    }
  } catch (e) {
    console.error(`  [Get on Board Error] ${e.message}`);
  }
}

async function scanComputrabajo(searchUrl, label) {
  console.log(`\n🔍 [Computrabajo] Escaneando: ${label}...`);
  runCamoufox('open', searchUrl);
  await sleep(3500);

  const rawJobs = evaluate(`() => {
    const articles = Array.from(document.querySelectorAll('article.box_offer, [data-id]')).map(art => {
      const link = art.querySelector('a.js-o-link, h2 a, h1 a');
      const comp = art.querySelector('p.fs16, .fc_base, .company');
      const loc = art.querySelector('p.fs13, .location');
      return {
        title: link ? link.innerText.trim() : '',
        url: link ? link.href : '',
        company: comp ? comp.innerText.trim() : 'Confidencial',
        location: loc ? loc.innerText.trim() : 'Santiago'
      };
    }).filter(j => j.title && j.url);
    return JSON.stringify(articles);
  }`);

  try {
    const items = JSON.parse(rawJobs);
    for (const j of items) {
      const clean = cleanUrl(j.url);
      if (!existingUrls.has(clean) && !isTitleExcluded(j.title)) {
        existingUrls.add(clean);
        foundJobs.push({ ...j, url: clean, portal: 'Computrabajo' });
        console.log(`  ✨ [Computrabajo] + ${j.company} — ${j.title}`);
      }
    }
  } catch (e) {
    console.error(`  [Computrabajo Error] ${e.message}`);
  }
}

async function scanChiletrabajos(query, label) {
  const searchUrl = `https://www.chiletrabajos.cl/encuentra-un-empleo?criterio=${encodeURIComponent(query)}`;
  console.log(`\n🔍 [Chiletrabajos] Escaneando: ${label}...`);
  runCamoufox('open', searchUrl);
  await sleep(3000);

  const rawJobs = evaluate(`() => {
    const items = Array.from(document.querySelectorAll('.job-item, .item, tr, .oferta')).map(el => {
      const link = el.querySelector('a[href*=\"/trabajo/\"]');
      const title = link ? link.innerText.trim() : '';
      const comp = el.querySelector('.empresa, .company, span.text-muted');
      return {
        title,
        url: link ? link.href : '',
        company: comp ? comp.innerText.trim() : 'Empresa',
        location: 'Chile'
      };
    }).filter(j => j.title && j.url && !j.url.includes('/postular/'));
    return JSON.stringify(items);
  }`);

  try {
    const items = JSON.parse(rawJobs);
    for (const j of items) {
      const clean = cleanUrl(j.url);
      if (!existingUrls.has(clean) && !isTitleExcluded(j.title)) {
        existingUrls.add(clean);
        foundJobs.push({ ...j, url: clean, portal: 'Chiletrabajos' });
        console.log(`  ✨ [Chiletrabajos] + ${j.company} — ${j.title}`);
      }
    }
  } catch (e) {
    console.error(`  [Chiletrabajos Error] ${e.message}`);
  }
}

async function main() {
  console.log(`======================================================================`);
  console.log(`🚀 INICIANDO ESCANEO EXCLUSIVO DE VACANTES JUNIOR (Chile & Remoto)`);
  console.log(`Filtro estricto: Junior / Trainee / Egresados — Excluyendo Seniors/Leads`);
  console.log(`======================================================================`);

  loadDedup();

  // 1. LinkedIn Easy Apply Junior Searches
  await scanLinkedIn('junior software engineer', 'Junior Software Engineer (Easy Apply)');
  await scanLinkedIn('junior backend', 'Junior Backend (Easy Apply)');
  await scanLinkedIn('junior devops', 'Junior DevOps (Easy Apply)');
  await scanLinkedIn('junior desarrollador', 'Junior Desarrollador (Easy Apply)');
  await scanLinkedIn('junior data engineer', 'Junior Data Engineer (Easy Apply)');
  await scanLinkedIn('trainee software', 'Trainee Software (Easy Apply)');

  // 2. Get on Board Junior
  await scanGetOnBoard('junior', 'programming');
  await scanGetOnBoard('junior', 'sysadmin-devops-qa');
  await scanGetOnBoard('junior', 'data-science-analytics');
  await scanGetOnBoard('trainee', 'programming');

  // 3. Computrabajo Chile
  await scanComputrabajo('https://cl.computrabajo.com/trabajo-de-desarrollador-junior', 'Desarrollador Junior');
  await scanComputrabajo('https://cl.computrabajo.com/trabajo-de-junior-informatica', 'Junior Informática');
  await scanComputrabajo('https://cl.computrabajo.com/trabajo-de-junior-software', 'Junior Software');

  // 4. Chiletrabajos
  await scanChiletrabajos('junior software', 'Junior Software');
  await scanChiletrabajos('junior desarrollador', 'Junior Desarrollador');
  await scanChiletrabajos('junior devops', 'Junior DevOps');
  await scanChiletrabajos('trainee informatica', 'Trainee Informática');

  console.log(`\n======================================================================`);
  console.log(`✅ Escaneo completado. Se encontraron ${foundJobs.length} ofertas nuevas Junior.`);
  console.log(`======================================================================`);

  if (foundJobs.length > 0) {
    // Append to data/pipeline.md
    const pipelineFile = join(process.cwd(), 'data/pipeline.md');
    let mdAppend = `\n### Lote Junior Escaneado — ${new Date().toISOString().slice(0, 10)}\n\n`;
    for (const j of foundJobs) {
      mdAppend += `- [ ] ${j.url} | ${j.company} | ${j.title} | ${j.portal} | posted: ${new Date().toISOString().slice(0, 10)}\n`;
    }
    appendFileSync(pipelineFile, mdAppend, 'utf-8');
    console.log(`[Pipeline] Agregadas ${foundJobs.length} ofertas a data/pipeline.md.`);

    // Save JSON record
    const recordPath = join(process.cwd(), 'data/junior-scanned.json');
    writeFileSync(recordPath, JSON.stringify(foundJobs, null, 2), 'utf-8');
    console.log(`[Registro] Guardado en data/junior-scanned.json.`);
  }
}

main().catch(err => {
  console.error(`[Error Fatal]:`, err);
  process.exit(1);
});
