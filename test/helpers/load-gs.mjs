import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Evaluate a trusted local Apps Script fixture in a Node VM context.
 *
 * This VM is not a security sandbox. Only load trusted fixture files from this
 * repository's test/ or src/ roots. Apps Script services must be supplied
 * explicitly through the `services` option.
 */
export function loadGs(file, options = {}) {
  const sourcePath = trustedFixturePath(file);
  const source = readFileSync(sourcePath, 'utf8');
  const { services = {}, globals = {}, names = [] } = Array.isArray(options)
    ? { names: options }
    : options;
  names.forEach((name) => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new TypeError(`Invalid named global: ${name}`);
    }
  });
  const context = vm.createContext({
    ...globals,
    ...services
  });
  const capture = names.length
    ? `\n;globalThis.__loadGsExports = {${names.map((name) =>
        `${JSON.stringify(name)}: typeof ${name} === 'undefined' ? undefined : ${name}`
      ).join(',')}};`
    : '';

  vm.runInContext(source + capture, context, { filename: sourcePath });

  if (!names.length) return context;
  return context.__loadGsExports;
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TRUSTED_ROOTS = ['test', 'src'].map((directory) =>
  realpathSync(resolve(REPOSITORY_ROOT, directory))
);

function trustedFixturePath(file) {
  const candidate = realpathSync(resolve(file));
  const trusted = TRUSTED_ROOTS.some((root) => candidate === root || candidate.startsWith(root + sep));
  if (!trusted) {
    throw new Error(`Refusing to load fixture outside trusted fixture roots: ${candidate}`);
  }
  return candidate;
}
