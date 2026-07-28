import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

/**
 * Evaluate a pure Apps Script module in an isolated Node VM context.
 *
 * The loader deliberately exposes no process, environment, filesystem, or
 * network objects. Apps Script services must be supplied explicitly through
 * the `services` option.
 */
export function loadGs(file, options = {}) {
  const sourcePath = resolve(file);
  const source = readFileSync(sourcePath, 'utf8');
  const { services = {}, globals = {}, names = [] } = Array.isArray(options)
    ? { names: options }
    : options;
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
