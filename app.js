(() => {
  'use strict';

  const CONFIG = Object.freeze({
    apiVersion: '2026-03-10',
    bundledUrl: 'pacotes/oratio-conteudos-devocionais-completos.zip',
    bundledName: 'oratio-conteudos-devocionais-completos.zip',
    bundledSha256: 'c2e3a1d4c4dfbb25c36d96e64254aebd0626c15433b4b90ab6371d7e1ae16eed',
    maxFiles: 5000,
    maxTotalBytes: 150 * 1024 * 1024,
    maxFileBytes: 50 * 1024 * 1024,
    maxTreeEntries: 75,
    maxTreePayloadBytes: 1_500_000,
    maxRenderedFiles: 250,
  });

  const ALLOWED_COLLECTIONS = Object.freeze([
    '_oracoes/',
    '_novenas/',
    '_quaresmas/',
    '_trintenas/',
    '_devocoes_mensais/',
    '_trezenas/',
    '_triduos/',
    '_dias_novena/',
    '_tercos/',
    '_rosarios/',
    '_coroas/',
    '_devocionarios/',
  ]);

  const MAIN_ITINERARY_PREFIXES = Object.freeze([
    '_novenas/',
    '_quaresmas/',
    '_trintenas/',
    '_devocoes_mensais/',
    '_trezenas/',
    '_triduos/',
  ]);

  const COUNTED_PREFIXES = Object.freeze(['_tercos/', '_rosarios/', '_coroas/']);
  const PROTECTED_PREFIXES = Object.freeze([
    '.github/',
    '_data/',
    '_includes/',
    '_layouts/',
    '_plugins/',
    'assets/css/',
    'assets/js/',
    'search/',
    'tools/',
  ]);
  const PROTECTED_FILES = new Set([
    '_config.yml',
    'Gemfile',
    'Gemfile.lock',
    'index.html',
    '404.html',
    'sitemap.xml',
    'robots.txt',
    'manifest.webmanifest',
    'CNAME',
  ]);
  const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.avif', '.gif', '.svg']);
  const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yml', '.yaml', '.json', '.csv', '.xml', '.html', '.svg', '.webmanifest']);
  const FORBIDDEN_MAIN_FIELDS = new Set([
    'sections', 'sequence_title', 'count', 'common_prayer', 'common-prayer',
    'texts', 'prayer', 'prayer-latin', 'prayer_latin', 'label', 'label-latin', 'label_latin',
  ]);

  const state = {
    packageName: '',
    packageSha256: '',
    included: [],
    excluded: [],
    errors: [],
    warnings: [],
    commonRefs: new Map(),
    localReady: false,
    comparison: null,
    publishing: false,
    cancelRequested: false,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    loadBundledButton: $('loadBundledButton'),
    zipInput: $('zipInput'),
    packageStatus: $('packageStatus'),
    zipSummary: $('zipSummary'),
    validationPanel: $('validationPanel'),
    errorList: $('errorList'),
    warningList: $('warningList'),
    ownerInput: $('ownerInput'),
    repoInput: $('repoInput'),
    baseBranchInput: $('baseBranchInput'),
    tokenInput: $('tokenInput'),
    toggleTokenButton: $('toggleTokenButton'),
    compareButton: $('compareButton'),
    clearTokenButton: $('clearTokenButton'),
    repoStatus: $('repoStatus'),
    comparisonPanel: $('comparisonPanel'),
    comparisonSummary: $('comparisonSummary'),
    newFilesList: $('newFilesList'),
    modifiedFilesList: $('modifiedFilesList'),
    unchangedFilesList: $('unchangedFilesList'),
    safeMode: $('safeMode'),
    directMode: $('directMode'),
    safeModeCard: $('safeModeCard'),
    directModeCard: $('directModeCard'),
    safeOptions: $('safeOptions'),
    directOptions: $('directOptions'),
    newBranchInput: $('newBranchInput'),
    createPrInput: $('createPrInput'),
    directRiskCheck: $('directRiskCheck'),
    directPhraseInput: $('directPhraseInput'),
    commitMessageInput: $('commitMessageInput'),
    overwriteConfirmationLabel: $('overwriteConfirmationLabel'),
    overwriteConfirmation: $('overwriteConfirmation'),
    overwriteConfirmationText: $('overwriteConfirmationText'),
    finalConfirmation: $('finalConfirmation'),
    publishButton: $('publishButton'),
    cancelButton: $('cancelButton'),
    progressPanel: $('progressPanel'),
    progressTitle: $('progressTitle'),
    progressPercent: $('progressPercent'),
    progressBar: $('progressBar'),
    progressDetail: $('progressDetail'),
    resultPanel: $('resultPanel'),
    logOutput: $('logOutput'),
  };

  function nowBranchName() {
    const d = new Date();
    const parts = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      '-',
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ];
    return `importacao-conteudos-${parts.join('')}`;
  }

  els.newBranchInput.value = nowBranchName();

  function log(message) {
    const stamp = new Date().toLocaleTimeString('pt-BR');
    els.logOutput.textContent += `\n[${stamp}] ${message}`;
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
  }

  function setStatus(element, message, kind = 'neutral') {
    element.textContent = message;
    element.className = `status ${kind}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: unit === 0 ? 0 : 2 })} ${units[unit]}`;
  }

  function hex(buffer) {
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function digestHex(algorithm, bytes) {
    if (!window.crypto?.subtle) {
      throw new Error('Este navegador não oferece a API criptográfica necessária. Abra a página por HTTPS em um navegador atualizado.');
    }
    return hex(await window.crypto.subtle.digest(algorithm, bytes));
  }

  async function gitBlobSha(bytes) {
    const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
    const input = new Uint8Array(header.byteLength + bytes.byteLength);
    input.set(header, 0);
    input.set(bytes, header.byteLength);
    return digestHex('SHA-1', input);
  }

  function extension(path) {
    const index = path.lastIndexOf('.');
    return index >= 0 ? path.slice(index).toLowerCase() : '';
  }

  function normalizePath(rawPath) {
    if (typeof rawPath !== 'string') throw new Error('Caminho ausente.');
    let path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    while (path.startsWith('/')) path = path.slice(1);
    path = path.replace(/\/+/g, '/');
    if (!path || path.includes('\0')) throw new Error('Caminho vazio ou inválido.');
    const parts = path.split('/');
    if (parts.some((part) => part === '..' || part === '.')) throw new Error(`Travessia de diretório recusada: ${rawPath}`);
    return path;
  }

  function isSymlink(entry) {
    const permissions = entry.unixPermissions;
    return typeof permissions === 'number' && (permissions & 0o170000) === 0o120000;
  }

  function classifyPath(path) {
    if (path.startsWith('__MACOSX/') || path.endsWith('/.DS_Store') || path === '.DS_Store') {
      return { action: 'ignore', reason: 'Metadado do sistema operacional' };
    }
    if (path.startsWith('tools/importacao_oracoes/')) {
      return { action: 'ignore', reason: 'Relatório técnico não destinado ao site' };
    }
    if (PROTECTED_FILES.has(path) || PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return { action: 'block', reason: 'Caminho de infraestrutura protegido' };
    }
    const collection = ALLOWED_COLLECTIONS.find((prefix) => path.startsWith(prefix));
    if (collection) {
      if (!path.toLowerCase().endsWith('.md')) return { action: 'block', reason: 'Coleções aceitam apenas Markdown' };
      return { action: 'include', type: 'text', collection };
    }
    if (path.startsWith('assets/images/')) {
      const ext = extension(path);
      if (!IMAGE_EXTENSIONS.has(ext)) return { action: 'block', reason: `Extensão de imagem não permitida: ${ext || '(sem extensão)'}` };
      return { action: 'include', type: TEXT_EXTENSIONS.has(ext) ? 'text' : 'binary', collection: 'assets/images/' };
    }
    return { action: 'ignore', reason: 'Fora das coleções permitidas' };
  }

  function simpleYamlValue(raw) {
    if (raw == null) return null;
    const value = raw.trim();
    if (!value) return null;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    if (/^-?\d+$/.test(value)) return Number(value);
    return value;
  }

  function parseFrontMatter(text, path, errors) {
    if (text.charCodeAt(0) === 0xfeff) {
      errors.push(`${path}: possui BOM antes do front matter; o validador do Oratio exige que o arquivo comece diretamente com ---.`);
      return null;
    }
    if (!text.startsWith('---\n')) {
      errors.push(`${path}: não começa com front matter YAML no formato --- seguido de quebra de linha LF.`);
      return null;
    }
    const end = text.indexOf('\n---\n', 4);
    if (end < 0) {
      errors.push(`${path}: front matter sem fechamento.`);
      return null;
    }
    const yaml = text.slice(4, end);
    const data = Object.create(null);
    const seen = new Set();
    for (const [index, line] of yaml.split('\n').entries()) {
      if (!line || /^\s/.test(line) || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (!match) continue;
      const key = match[1];
      if (seen.has(key)) errors.push(`${path}: chave YAML superior duplicada '${key}' (linha ${index + 1} do front matter).`);
      seen.add(key);
      data[key] = simpleYamlValue(match[2]);
    }
    return { data, yaml, body: text.slice(end + 5) };
  }

  function addCommonRefs(path, text) {
    const regex = /^\s*(?:common_prayer|common-prayer):\s*["']?([a-z0-9-]+)["']?\s*$/gm;
    for (const match of text.matchAll(regex)) {
      if (!state.commonRefs.has(match[1])) state.commonRefs.set(match[1], new Set());
      state.commonRefs.get(match[1]).add(path);
    }
  }

  function validateMarkdown(path, text, errors, warnings, metadata) {
    if (text.includes('\u0000')) errors.push(`${path}: contém caractere nulo.`);
    if (text.includes('\r\n')) warnings.push(`${path}: usa CRLF; o padrão do projeto e do validador é LF.`);
    if (/\/\/KEY=/.test(text)) errors.push(`${path}: contém marcador //KEY= não resolvido.`);
    if (/^\s*\d+\.\s+/m.test(text)) warnings.push(`${path}: há linha iniciada por número e ponto; confirme se o número bíblico foi escapado como 1\\.`);

    const parsed = parseFrontMatter(text, path, errors);
    if (!parsed) return;
    const { data, yaml } = parsed;
    metadata.set(path, data);
    addCommonRefs(path, text);

    for (const countMatch of yaml.matchAll(/^\s*count:\s*(.*?)\s*$/gm)) {
      const count = countMatch[1].replace(/["']/g, '');
      if (!/^\d+$/.test(count) || Number(count) < 1) errors.push(`${path}: count deve ser inteiro positivo, mas foi encontrado '${count}'.`);
    }

    const requiredBase = ['title'];
    if (!path.startsWith('_dias_novena/')) requiredBase.push('slug', 'description', 'image', 'image_alt');
    for (const key of requiredBase) {
      if (data[key] == null || data[key] === '') errors.push(`${path}: campo obrigatório '${key}' ausente ou vazio.`);
    }

    const mainPrefix = MAIN_ITINERARY_PREFIXES.find((prefix) => path.startsWith(prefix));
    if (mainPrefix) {
      for (const key of FORBIDDEN_MAIN_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) errors.push(`${path}: página principal de itinerário não pode declarar '${key}'.`);
      }
      if (!Number.isInteger(data.days) || data.days < 1) errors.push(`${path}: campo days deve ser inteiro positivo.`);
      if (!/^calendar:\s*$/m.test(yaml)) errors.push(`${path}: página principal não declara calendar.`);
    }

    if (path.startsWith('_dias_novena/')) {
      const match = path.match(/^_dias_novena\/([^/]+)\/dia-(\d+)\.md$/);
      if (!match) {
        errors.push(`${path}: caminho diário deve seguir _dias_novena/{slug}/dia-N.md.`);
      } else {
        const folderSlug = match[1];
        const number = Number(match[2]);
        if (data.devotion !== folderSlug) errors.push(`${path}: devotion deve ser exatamente '${folderSlug}'.`);
        if (data.day !== number) errors.push(`${path}: day deve corresponder ao número ${number} do arquivo.`);
      }
      if (!data.permalink || typeof data.permalink !== 'string') errors.push(`${path}: permalink explícito ausente.`);
      if (data.search !== false) errors.push(`${path}: dias devem usar search: false.`);
      if (Object.prototype.hasOwnProperty.call(data, 'image') || Object.prototype.hasOwnProperty.call(data, 'image_alt')) {
        errors.push(`${path}: dias não podem repetir image nem image_alt.`);
      }
    }

    if (COUNTED_PREFIXES.some((prefix) => path.startsWith(prefix)) && !/^sections:\s*$/m.test(yaml)) {
      errors.push(`${path}: terços, rosários e coroas precisam declarar sections.`);
    }

    if (data.slug && !/^[a-z0-9-]+$/.test(String(data.slug))) errors.push(`${path}: slug contém caracteres fora de [a-z0-9-].`);
    if (data.image && typeof data.image === 'string' && !data.image.startsWith('/assets/images/')) {
      warnings.push(`${path}: image não começa com /assets/images/.`);
    }
  }

  function validateItineraryCompleteness(metadata, errors) {
    const daysBySlug = new Map();
    for (const [path, data] of metadata.entries()) {
      const match = path.match(/^_dias_novena\/([^/]+)\/dia-(\d+)\.md$/);
      if (!match) continue;
      const slug = match[1];
      if (!daysBySlug.has(slug)) daysBySlug.set(slug, new Set());
      daysBySlug.get(slug).add(Number(match[2]));
    }
    for (const [path, data] of metadata.entries()) {
      if (!MAIN_ITINERARY_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
      if (!data.slug || !Number.isInteger(data.days)) continue;
      const days = daysBySlug.get(String(data.slug)) || new Set();
      const missing = [];
      for (let i = 1; i <= data.days; i += 1) if (!days.has(i)) missing.push(i);
      if (missing.length) {
        const sample = missing.slice(0, 15).join(', ');
        errors.push(`${path}: pacote não contém a sequência completa de ${data.days} dias. Faltam: ${sample}${missing.length > 15 ? '…' : ''}.`);
      }
      for (const day of days) if (day > data.days) errors.push(`${path}: pacote contém dia-${day}.md acima de days: ${data.days}.`);
    }
  }

  function renderList(element, items, emptyMessage = 'Nenhum item.') {
    element.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = emptyMessage;
      element.append(li);
      return;
    }
    const limit = Math.min(items.length, CONFIG.maxRenderedFiles);
    for (let i = 0; i < limit; i += 1) {
      const li = document.createElement('li');
      li.textContent = items[i];
      element.append(li);
    }
    if (items.length > limit) {
      const li = document.createElement('li');
      li.textContent = `… e mais ${items.length - limit} itens.`;
      element.append(li);
    }
  }

  function metric(label, value) {
    const box = document.createElement('div');
    box.className = 'metric';
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    box.append(strong, span);
    return box;
  }

  function renderMetrics(container, values) {
    container.replaceChildren(...values.map(([label, value]) => metric(label, value)));
  }

  function resetComparison() {
    state.comparison = null;
    els.comparisonPanel.classList.add('hidden');
    els.overwriteConfirmation.checked = false;
    els.overwriteConfirmationLabel.classList.add('hidden');
    els.finalConfirmation.checked = false;
    els.resultPanel.classList.add('hidden');
    updateButtons();
  }

  async function loadZip(arrayBuffer, packageName, expectedSha256 = null) {
    resetComparison();
    state.packageName = packageName;
    state.packageSha256 = '';
    state.included = [];
    state.excluded = [];
    state.errors = [];
    state.warnings = [];
    state.commonRefs = new Map();
    state.localReady = false;
    els.validationPanel.classList.add('hidden');
    els.zipSummary.classList.add('hidden');
    setStatus(els.packageStatus, 'Calculando integridade e abrindo o ZIP…', 'working');
    log(`Iniciando auditoria de ${packageName}.`);

    try {
      const packageBytes = new Uint8Array(arrayBuffer);
      state.packageSha256 = await digestHex('SHA-256', packageBytes);
      if (expectedSha256 && state.packageSha256 !== expectedSha256) {
        state.errors.push(`O SHA-256 do pacote incluído não corresponde ao valor esperado. Esperado ${expectedSha256}; recebido ${state.packageSha256}.`);
      }

      const zip = await JSZip.loadAsync(arrayBuffer, { checkCRC32: true, createFolders: false });
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      if (entries.length > CONFIG.maxFiles) state.errors.push(`O ZIP possui ${entries.length} arquivos, acima do limite de segurança de ${CONFIG.maxFiles}.`);

      const normalizedSeen = new Set();
      const metadata = new Map();
      let totalBytes = 0;

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (index % 40 === 0) setStatus(els.packageStatus, `Auditando arquivo ${index + 1} de ${entries.length}…`, 'working');
        if (isSymlink(entry)) {
          state.errors.push(`${entry.name}: links simbólicos não são permitidos.`);
          continue;
        }

        let path;
        try {
          path = normalizePath(entry.name);
        } catch (error) {
          state.errors.push(`${entry.name}: ${error.message}`);
          continue;
        }
        if (normalizedSeen.has(path)) {
          state.errors.push(`${path}: caminho duplicado no ZIP.`);
          continue;
        }
        normalizedSeen.add(path);

        const classification = classifyPath(path);
        if (classification.action === 'block') {
          state.errors.push(`${path}: ${classification.reason}.`);
          continue;
        }
        if (classification.action === 'ignore') {
          state.excluded.push({ path, reason: classification.reason });
          continue;
        }

        const bytes = await entry.async('uint8array');
        totalBytes += bytes.byteLength;
        if (bytes.byteLength > CONFIG.maxFileBytes) state.errors.push(`${path}: arquivo com ${formatBytes(bytes.byteLength)}, acima do limite de ${formatBytes(CONFIG.maxFileBytes)}.`);
        if (totalBytes > CONFIG.maxTotalBytes) {
          state.errors.push(`Conteúdo descompactado excede ${formatBytes(CONFIG.maxTotalBytes)}.`);
          break;
        }

        const item = { path, bytes, size: bytes.byteLength, kind: classification.type, text: null, localGitSha: null };
        if (classification.type === 'text') {
          try {
            item.text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            state.errors.push(`${path}: texto não é UTF-8 válido.`);
            continue;
          }
          if (path.endsWith('.md')) validateMarkdown(path, item.text, state.errors, state.warnings, metadata);
        }
        state.included.push(item);
      }

      validateItineraryCompleteness(metadata, state.errors);

      const collectionCounts = new Map();
      for (const item of state.included) {
        const key = ALLOWED_COLLECTIONS.find((prefix) => item.path.startsWith(prefix)) || 'assets/images/';
        collectionCounts.set(key, (collectionCounts.get(key) || 0) + 1);
      }
      const totalIncluded = state.included.reduce((sum, item) => sum + item.size, 0);
      renderMetrics(els.zipSummary, [
        ['Arquivos aceitos', state.included.length.toLocaleString('pt-BR')],
        ['Arquivos ignorados', state.excluded.length.toLocaleString('pt-BR')],
        ['Tamanho aceito', formatBytes(totalIncluded)],
        ['Erros', state.errors.length.toLocaleString('pt-BR')],
        ['Avisos', state.warnings.length.toLocaleString('pt-BR')],
        ['SHA-256', state.packageSha256.slice(0, 12) + '…'],
      ]);
      els.zipSummary.classList.remove('hidden');
      els.validationPanel.classList.remove('hidden');
      renderList(els.errorList, state.errors);
      const collectionSummary = Array.from(collectionCounts.entries()).map(([key, count]) => `${key}: ${count} arquivo(s)`);
      const excludedSummary = state.excluded.slice(0, 20).map((item) => `${item.path}: ${item.reason}`);
      renderList(els.warningList, [...state.warnings, ...collectionSummary, ...excludedSummary]);

      state.localReady = state.included.length > 0 && state.errors.length === 0;
      if (state.localReady) {
        setStatus(els.packageStatus, `${packageName} aprovado na auditoria local: ${state.included.length.toLocaleString('pt-BR')} arquivos prontos para comparação.`, 'success');
        log(`Auditoria local concluída sem erros: ${state.included.length} arquivos aceitos e ${state.excluded.length} ignorados.`);
      } else {
        setStatus(els.packageStatus, `O pacote possui ${state.errors.length} erro(s) impeditivo(s). Nenhuma publicação será liberada.`, 'error');
        log(`Auditoria local bloqueada por ${state.errors.length} erro(s).`);
      }
    } catch (error) {
      state.errors.push(error.message || String(error));
      state.localReady = false;
      setStatus(els.packageStatus, `Não foi possível processar o ZIP: ${error.message}`, 'error');
      els.validationPanel.classList.remove('hidden');
      renderList(els.errorList, state.errors);
      renderList(els.warningList, state.warnings);
      log(`Falha ao abrir ZIP: ${error.message}`);
    }
    updateButtons();
  }

  function cleanRepositoryInput(value, label) {
    const clean = value.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(clean)) throw new Error(`${label} contém caracteres inválidos.`);
    return clean;
  }

  function cleanBranch(value) {
    const clean = value.trim();
    if (!clean || clean.startsWith('/') || clean.endsWith('/') || clean.includes('..') || clean.includes('~') || clean.includes('^') || clean.includes(':') || clean.includes('?') || clean.includes('*') || clean.includes('[') || clean.includes('\\') || /\s/.test(clean)) {
      throw new Error('Nome de branch inválido.');
    }
    return clean;
  }

  function encodeRef(branch) {
    return branch.split('/').map(encodeURIComponent).join('/');
  }

  function getToken() {
    const token = els.tokenInput.value.trim();
    if (!token) throw new Error('Informe a chave de acesso do GitHub.');
    return token;
  }

  function redact(text) {
    const token = els.tokenInput.value.trim();
    return token ? String(text).split(token).join('[CHAVE REMOVIDA]') : String(text);
  }

  async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const url = path.startsWith('https://') ? path : `https://api.github.com${path}`;
    const method = options.method || 'GET';
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': CONFIG.apiVersion,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=UTF-8';

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        const text = await response.text();
        let data = null;
        if (text) {
          try { data = JSON.parse(text); } catch { data = text; }
        }
        if (response.ok) return { data, response };

        const message = typeof data === 'object' && data?.message ? data.message : (text || response.statusText);
        const retryAfter = Number(response.headers.get('Retry-After'));
        if ((response.status === 429 || response.status >= 500 || (response.status === 403 && retryAfter)) && attempt < 3) {
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
          log(`GitHub respondeu HTTP ${response.status}; nova tentativa em ${Math.ceil(delay / 1000)} s.`);
          await wait(delay);
          continue;
        }
        const error = new Error(`GitHub HTTP ${response.status}: ${message}`);
        error.status = response.status;
        error.data = data;
        throw error;
      } catch (error) {
        lastError = error;
        if (error.status || attempt === 3) throw error;
        await wait(attempt * 1500);
      }
    }
    throw lastError || new Error('Falha desconhecida na API do GitHub.');
  }

  function decodeBase64Utf8(base64) {
    const binary = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function commonPrayerKeys(yamlText) {
    const keys = new Set();
    for (const match of yamlText.matchAll(/^([a-z0-9-]+):\s*$/gm)) keys.add(match[1]);
    return keys;
  }

  async function compareWithRepository() {
    if (!state.localReady) return;
    resetComparison();
    setStatus(els.repoStatus, 'Verificando credenciais, branch e árvore atual…', 'working');
    els.compareButton.disabled = true;
    log('Iniciando comparação com o repositório remoto.');

    try {
      const owner = cleanRepositoryInput(els.ownerInput.value, 'Proprietário');
      const repo = cleanRepositoryInput(els.repoInput.value, 'Repositório');
      const baseBranch = cleanBranch(els.baseBranchInput.value);
      getToken();
      const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

      const repoResult = await apiFetch(base);
      if (!repoResult.data?.permissions?.push && repoResult.data?.permissions) {
        throw new Error('A chave não possui permissão de escrita neste repositório.');
      }

      const refResult = await apiFetch(`${base}/git/ref/heads/${encodeRef(baseBranch)}`);
      const headSha = refResult.data?.object?.sha;
      if (!headSha) throw new Error('Não foi possível obter o commit atual da branch.');
      const commitResult = await apiFetch(`${base}/git/commits/${encodeURIComponent(headSha)}`);
      const treeSha = commitResult.data?.tree?.sha;
      if (!treeSha) throw new Error('Não foi possível obter a árvore-base do commit.');

      setStatus(els.repoStatus, 'Baixando o índice da árvore atual para comparar arquivos…', 'working');
      const treeResult = await apiFetch(`${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
      if (treeResult.data?.truncated) {
        throw new Error('A árvore recursiva do repositório foi truncada pelo GitHub. Por segurança, a publicação foi bloqueada para evitar classificar arquivos existentes como novos.');
      }
      const remoteMap = new Map();
      for (const node of treeResult.data?.tree || []) if (node.type === 'blob') remoteMap.set(node.path, node.sha);

      let commonKeys = new Set();
      try {
        const commonResult = await apiFetch(`${base}/contents/_data/common_prayers.yml?ref=${encodeURIComponent(baseBranch)}`);
        if (commonResult.data?.content) commonKeys = commonPrayerKeys(decodeBase64Utf8(commonResult.data.content));
      } catch (error) {
        state.warnings.push(`Não foi possível conferir _data/common_prayers.yml: ${redact(error.message)}`);
      }

      const missingCommon = [];
      for (const [key, paths] of state.commonRefs.entries()) {
        if (commonKeys.size && !commonKeys.has(key)) missingCommon.push(`${key} (${Array.from(paths).slice(0, 3).join(', ')})`);
      }
      if (missingCommon.length) throw new Error(`O pacote referencia orações comuns inexistentes no repositório: ${missingCommon.slice(0, 12).join('; ')}${missingCommon.length > 12 ? '…' : ''}`);

      const newFiles = [];
      const modifiedFiles = [];
      const unchangedFiles = [];
      for (let index = 0; index < state.included.length; index += 1) {
        const item = state.included[index];
        if (index % 100 === 0) setStatus(els.repoStatus, `Comparando conteúdo ${index + 1} de ${state.included.length}…`, 'working');
        item.localGitSha = await gitBlobSha(item.bytes);
        const remoteSha = remoteMap.get(item.path);
        if (!remoteSha) newFiles.push(item);
        else if (remoteSha === item.localGitSha) unchangedFiles.push(item);
        else modifiedFiles.push(item);
      }

      state.comparison = {
        owner, repo, baseBranch, base, headSha, treeSha,
        newFiles, modifiedFiles, unchangedFiles,
        changedFiles: [...newFiles, ...modifiedFiles],
      };

      renderMetrics(els.comparisonSummary, [
        ['Novos', newFiles.length.toLocaleString('pt-BR')],
        ['Modificados', modifiedFiles.length.toLocaleString('pt-BR')],
        ['Idênticos', unchangedFiles.length.toLocaleString('pt-BR')],
        ['Commit-base', headSha.slice(0, 10)],
      ]);
      renderList(els.newFilesList, newFiles.map((item) => item.path));
      renderList(els.modifiedFilesList, modifiedFiles.map((item) => item.path));
      renderList(els.unchangedFilesList, unchangedFiles.map((item) => item.path));
      els.comparisonPanel.classList.remove('hidden');

      if (modifiedFiles.length) {
        els.overwriteConfirmationLabel.classList.remove('hidden');
        els.overwriteConfirmationText.textContent = `Confirmo a substituição dos ${modifiedFiles.length.toLocaleString('pt-BR')} arquivos existentes listados acima.`;
      }

      if (!state.comparison.changedFiles.length) {
        setStatus(els.repoStatus, 'Todos os arquivos aceitos já são idênticos aos existentes. Nenhum commit é necessário.', 'success');
      } else {
        setStatus(els.repoStatus, `Comparação concluída: ${state.comparison.changedFiles.length.toLocaleString('pt-BR')} arquivo(s) serão adicionados ou atualizados.`, 'success');
      }
      log(`Comparação concluída no commit ${headSha.slice(0, 12)}: ${newFiles.length} novos, ${modifiedFiles.length} modificados e ${unchangedFiles.length} idênticos.`);
    } catch (error) {
      setStatus(els.repoStatus, redact(error.message), 'error');
      log(`Comparação bloqueada: ${redact(error.message)}`);
    } finally {
      updateButtons();
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  function updateProgress(done, total, title, detail) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressPanel.classList.remove('hidden');
    els.progressTitle.textContent = title;
    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.value = percent;
    els.progressDetail.textContent = detail;
  }

  function splitTreeBatches(nodes, baseTreeSha) {
    const batches = [];
    let current = [];
    for (const node of nodes) {
      const candidate = [...current, node];
      const bodySize = new TextEncoder().encode(JSON.stringify({ base_tree: baseTreeSha, tree: candidate })).byteLength;
      if (current.length && (candidate.length > CONFIG.maxTreeEntries || bodySize > CONFIG.maxTreePayloadBytes)) {
        batches.push(current);
        current = [node];
      } else {
        current = candidate;
      }
    }
    if (current.length) batches.push(current);
    return batches;
  }

  function appendResultLink(container, label, href) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(a);
    container.append(p);
  }

  async function publish() {
    if (!state.comparison || !state.comparison.changedFiles.length || state.publishing) return;
    const comparison = state.comparison;
    state.publishing = true;
    state.cancelRequested = false;
    els.resultPanel.classList.add('hidden');
    els.resultPanel.replaceChildren();
    updateButtons();
    els.cancelButton.disabled = false;
    log('Publicação iniciada.');

    try {
      getToken();
      const mode = els.safeMode.checked ? 'branch' : 'direct';
      const commitMessage = els.commitMessageInput.value.trim();
      if (!commitMessage) throw new Error('Informe a mensagem do commit.');
      const newBranch = mode === 'branch' ? cleanBranch(els.newBranchInput.value) : null;
      if (mode === 'branch' && newBranch === comparison.baseBranch) throw new Error('A branch de revisão deve ser diferente da branch-base.');

      updateProgress(0, 1, 'Verificando concorrência', 'Confirmando que a branch-base não mudou desde a comparação.');
      const latestRef = await apiFetch(`${comparison.base}/git/ref/heads/${encodeRef(comparison.baseBranch)}`);
      const latestHead = latestRef.data?.object?.sha;
      if (latestHead !== comparison.headSha) {
        throw new Error('A branch-base recebeu outro commit depois da comparação. Nada foi alterado. Compare novamente para trabalhar sobre a versão mais recente.');
      }

      const changed = comparison.changedFiles;
      const nodes = [];
      const binaryItems = changed.filter((item) => item.kind === 'binary');
      let binaryDone = 0;
      for (const item of changed) {
        if (state.cancelRequested) throw new Error('Publicação cancelada antes da criação do commit.');
        if (item.kind === 'binary') {
          updateProgress(binaryDone, Math.max(binaryItems.length, 1), 'Enviando arquivos binários', item.path);
          const blobResult = await apiFetch(`${comparison.base}/git/blobs`, {
            method: 'POST',
            body: { content: bytesToBase64(item.bytes), encoding: 'base64' },
          });
          if (!blobResult.data?.sha) throw new Error(`O GitHub não devolveu o SHA do blob ${item.path}.`);
          nodes.push({ path: item.path, mode: '100644', type: 'blob', sha: blobResult.data.sha });
          binaryDone += 1;
        } else {
          nodes.push({ path: item.path, mode: '100644', type: 'blob', content: item.text });
        }
      }

      const batches = splitTreeBatches(nodes, comparison.treeSha);
      let treeSha = comparison.treeSha;
      for (let i = 0; i < batches.length; i += 1) {
        if (state.cancelRequested) throw new Error('Publicação cancelada antes da criação do commit.');
        updateProgress(i, batches.length, 'Criando árvores em lotes', `Lote ${i + 1} de ${batches.length}, com ${batches[i].length} arquivo(s).`);
        const treeResult = await apiFetch(`${comparison.base}/git/trees`, {
          method: 'POST',
          body: { base_tree: treeSha, tree: batches[i] },
        });
        if (!treeResult.data?.sha) throw new Error(`O GitHub não devolveu o SHA da árvore do lote ${i + 1}.`);
        treeSha = treeResult.data.sha;
      }

      if (state.cancelRequested) throw new Error('Publicação cancelada antes da criação do commit.');
      updateProgress(batches.length, batches.length, 'Criando um único commit', commitMessage);
      const commitResult = await apiFetch(`${comparison.base}/git/commits`, {
        method: 'POST',
        body: { message: commitMessage, tree: treeSha, parents: [comparison.headSha] },
      });
      const commitSha = commitResult.data?.sha;
      if (!commitSha) throw new Error('O GitHub não devolveu o SHA do novo commit.');

      let branchUrl;
      let prUrl = null;
      if (mode === 'branch') {
        updateProgress(1, 1, 'Criando branch de revisão', newBranch);
        await apiFetch(`${comparison.base}/git/refs`, {
          method: 'POST',
          body: { ref: `refs/heads/${newBranch}`, sha: commitSha },
        });
        branchUrl = `https://github.com/${encodeURIComponent(comparison.owner)}/${encodeURIComponent(comparison.repo)}/tree/${encodeRef(newBranch)}`;

        if (els.createPrInput.checked) {
          try {
            const prResult = await apiFetch(`${comparison.base}/pulls`, {
              method: 'POST',
              body: {
                title: commitMessage,
                head: newBranch,
                base: comparison.baseBranch,
                body: [
                  'Importação criada pela ferramenta segura de conteúdos do Oratio.',
                  '',
                  `- Arquivos novos: ${comparison.newFiles.length}`,
                  `- Arquivos modificados: ${comparison.modifiedFiles.length}`,
                  `- Arquivos idênticos ignorados: ${comparison.unchangedFiles.length}`,
                  `- Pacote: ${state.packageName}`,
                  `- SHA-256 do pacote: ${state.packageSha256}`,
                  '',
                  'A branch principal não foi alterada por esta ferramenta. Revise as mudanças antes da mesclagem.',
                ].join('\n'),
              },
            });
            prUrl = prResult.data?.html_url || null;
          } catch (error) {
            log(`Branch criada, mas a Pull Request não pôde ser aberta: ${redact(error.message)}`);
          }
        }
      } else {
        updateProgress(1, 1, 'Confirmando a branch-base novamente', 'A atualização será recusada se outro commit tiver sido publicado.');
        const finalRef = await apiFetch(`${comparison.base}/git/ref/heads/${encodeRef(comparison.baseBranch)}`);
        if (finalRef.data?.object?.sha !== comparison.headSha) {
          throw new Error('A branch-base mudou durante o envio. O novo commit não foi ligado à branch e nenhum conteúdo publicado foi sobrescrito. Compare novamente.');
        }
        await apiFetch(`${comparison.base}/git/refs/heads/${encodeRef(comparison.baseBranch)}`, {
          method: 'PATCH',
          body: { sha: commitSha, force: false },
        });
        branchUrl = `https://github.com/${encodeURIComponent(comparison.owner)}/${encodeURIComponent(comparison.repo)}/commit/${commitSha}`;
      }

      updateProgress(1, 1, 'Publicação concluída', `Commit ${commitSha.slice(0, 12)} criado sem force.`);
      const heading = document.createElement('h3');
      heading.textContent = mode === 'branch' ? 'Branch de revisão criada com sucesso' : 'Commit publicado com sucesso';
      const summary = document.createElement('p');
      summary.textContent = `${comparison.changedFiles.length.toLocaleString('pt-BR')} arquivo(s) incluídos em um único commit. Nenhum arquivo foi excluído.`;
      els.resultPanel.append(heading, summary);
      appendResultLink(els.resultPanel, mode === 'branch' ? 'Abrir branch no GitHub' : 'Abrir commit no GitHub', branchUrl);
      if (prUrl) appendResultLink(els.resultPanel, 'Abrir Pull Request para revisão', prUrl);
      appendResultLink(els.resultPanel, 'Abrir GitHub Actions do Oratio', `https://github.com/${encodeURIComponent(comparison.owner)}/${encodeURIComponent(comparison.repo)}/actions`);
      els.resultPanel.classList.remove('hidden');
      log(`Publicação concluída no commit ${commitSha}.`);
      els.tokenInput.value = '';
      resetComparisonAfterSuccess();
    } catch (error) {
      const message = redact(error.message || String(error));
      updateProgress(0, 1, 'Publicação interrompida', message);
      setStatus(els.repoStatus, message, 'error');
      log(`Publicação interrompida: ${message}`);
    } finally {
      state.publishing = false;
      els.cancelButton.disabled = true;
      updateButtons();
    }
  }

  function resetComparisonAfterSuccess() {
    state.comparison = null;
    els.finalConfirmation.checked = false;
    els.overwriteConfirmation.checked = false;
  }

  function updateModeUi() {
    const safe = els.safeMode.checked;
    els.safeOptions.classList.toggle('hidden', !safe);
    els.directOptions.classList.toggle('hidden', safe);
    els.safeModeCard.classList.toggle('selected', safe);
    els.directModeCard.classList.toggle('selected', !safe);
    updateButtons();
  }

  function updateButtons() {
    const tokenPresent = Boolean(els.tokenInput.value.trim());
    els.compareButton.disabled = state.publishing || !state.localReady || !tokenPresent;

    const comparisonReady = Boolean(state.comparison?.changedFiles?.length);
    const overwriteOk = !state.comparison?.modifiedFiles?.length || els.overwriteConfirmation.checked;
    const finalOk = els.finalConfirmation.checked;
    const safe = els.safeMode.checked;
    const directOk = safe || (els.directRiskCheck.checked && els.directPhraseInput.value.trim() === 'PUBLICAR NA MAIN');
    let branchOk = true;
    if (safe) {
      try { branchOk = Boolean(cleanBranch(els.newBranchInput.value)); } catch { branchOk = false; }
    }
    els.publishButton.disabled = state.publishing || !tokenPresent || !comparisonReady || !overwriteOk || !finalOk || !directOk || !branchOk;
  }

  els.loadBundledButton.addEventListener('click', async () => {
    els.loadBundledButton.disabled = true;
    try {
      setStatus(els.packageStatus, 'Baixando o pacote incluído no próprio site…', 'working');
      const response = await fetch(CONFIG.bundledUrl, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadZip(await response.arrayBuffer(), CONFIG.bundledName, CONFIG.bundledSha256);
    } catch (error) {
      setStatus(els.packageStatus, `Não foi possível carregar o pacote incluído: ${error.message}. Use o seletor de arquivo.`, 'error');
      log(`Falha ao carregar pacote incluído: ${error.message}`);
    } finally {
      els.loadBundledButton.disabled = false;
    }
  });

  els.zipInput.addEventListener('change', async () => {
    const file = els.zipInput.files?.[0];
    if (!file) return;
    await loadZip(await file.arrayBuffer(), file.name);
    els.zipInput.value = '';
  });
  els.compareButton.addEventListener('click', compareWithRepository);
  els.publishButton.addEventListener('click', publish);
  els.cancelButton.addEventListener('click', () => {
    state.cancelRequested = true;
    els.cancelButton.disabled = true;
    log('Cancelamento solicitado; a operação será interrompida após a chamada atual.');
  });
  els.clearTokenButton.addEventListener('click', () => {
    els.tokenInput.value = '';
    els.tokenInput.type = 'password';
    els.toggleTokenButton.textContent = 'Mostrar';
    resetComparison();
    setStatus(els.repoStatus, 'Chave apagada da memória desta página.', 'neutral');
    updateButtons();
  });
  els.toggleTokenButton.addEventListener('click', () => {
    const show = els.tokenInput.type === 'password';
    els.tokenInput.type = show ? 'text' : 'password';
    els.toggleTokenButton.textContent = show ? 'Ocultar' : 'Mostrar';
  });

  [els.ownerInput, els.repoInput, els.baseBranchInput].forEach((input) => input.addEventListener('input', resetComparison));
  [els.tokenInput, els.newBranchInput, els.directPhraseInput, els.commitMessageInput].forEach((input) => input.addEventListener('input', updateButtons));
  [els.overwriteConfirmation, els.finalConfirmation, els.directRiskCheck].forEach((input) => input.addEventListener('change', updateButtons));
  [els.safeMode, els.directMode].forEach((input) => input.addEventListener('change', updateModeUi));

  window.addEventListener('beforeunload', (event) => {
    if (!state.publishing) return;
    event.preventDefault();
    event.returnValue = '';
  });

  updateModeUi();
  updateButtons();
  log('Proteções ativas: allowlist de conteúdo, sem exclusões, sem force e branch de revisão por padrão.');
})();
