import { defineOperation } from '../registry.js';
import { SQL_LANGUAGES, formatSql, isLikelySql, minifySql } from '../formats/sql.js';
import { formatJson, isLikelyJson, minifyJson, validateJson } from '../formats/json.js';
import { XML_LANGUAGES, formatXml, isLikelyXml, minifyXml, validateXml } from '../formats/xml.js';
import { YAML_LANGUAGES, formatYaml, minifyYaml, repairYaml, validateYaml } from '../formats/yaml.js';
import { isYaml, looksLikeYamlNotOther } from '../formats/detect.js';

const diagnoseWith = (validator) => (input) => {
  const result = validator(input);
  return result.valid ? undefined : result.message;
};

function formatOperation({ id, name, language, languages, validate, diagnose, run, aliases = [], ...rest }) {
  return defineOperation({
    id,
    name,
    category: 'Format',
    inputType: language,
    outputType: language,
    inputLanguages: languages,
    supportsFencedBlock: true,
    aliases,
    validate,
    diagnose,
    run,
    invalidInputMessage: `Invalid ${language.toUpperCase()}. Please highlight valid ${language.toUpperCase()} first.`,
    noMatchingBlockMessage: `No valid ${language.toUpperCase()} fenced code block found in the selection.`,
    ...rest,
  });
}

const looksLikeJsonContainer = (input) => /^[{[]/.test(String(input).trim());

export const formattingOperations = [
  formatOperation({
    id: 'format.sql-beautify',
    name: 'Beautify SQL',
    description: 'Indent SQL with one clause per line and upper-case keywords.',
    language: 'sql',
    languages: SQL_LANGUAGES,
    aliases: ['prettify sql', 'format sql'],
    validate: isLikelySql,
    invalidInputMessage:
      'This does not look like SQL. Select a SQL statement (starting with SELECT, INSERT, UPDATE, …) first.',
    run: formatSql,
  }),
  formatOperation({
    id: 'format.sql-minify',
    name: 'Minify SQL',
    description: 'Collapse SQL onto as few lines as possible.',
    language: 'sql',
    languages: SQL_LANGUAGES,
    aliases: ['compress sql'],
    validate: isLikelySql,
    invalidInputMessage: 'This does not look like SQL. Select a SQL statement first.',
    run: minifySql,
  }),
  formatOperation({
    id: 'format.json-beautify',
    name: 'Beautify JSON',
    description: 'Indent JSON without changing any value (numbers and duplicate keys are kept verbatim).',
    language: 'json',
    languages: ['json', 'jsonc', 'json5'],
    aliases: ['prettify json', 'pretty print', 'format json'],
    options: [{ key: 'indent', label: 'Indent', type: 'select', default: '4', choices: ['2', '4', 'tab'] }],
    validate: looksLikeJsonContainer,
    detect: isLikelyJson,
    diagnose: diagnoseWith(validateJson),
    run: (input, { indent }) => formatJson(input, indent === 'tab' ? '\t' : Number(indent)),
  }),
  formatOperation({
    id: 'format.json-minify',
    name: 'Minify JSON',
    description: 'Remove insignificant whitespace from JSON.',
    language: 'json',
    languages: ['json'],
    aliases: ['compact json', 'compress json'],
    validate: looksLikeJsonContainer,
    detect: isLikelyJson,
    diagnose: diagnoseWith(validateJson),
    run: minifyJson,
  }),
  formatOperation({
    id: 'format.xml-beautify',
    name: 'Beautify XML',
    description: 'Indent XML elements; text-only and mixed-content elements stay exactly as written.',
    language: 'xml',
    languages: XML_LANGUAGES,
    aliases: ['prettify xml', 'format xml'],
    validate: (input) => /^\s*</.test(input),
    detect: isLikelyXml,
    diagnose: diagnoseWith(validateXml),
    run: (input) => formatXml(input),
  }),
  formatOperation({
    id: 'format.xml-minify',
    name: 'Minify XML',
    description: 'Remove whitespace between XML elements (text content is preserved).',
    language: 'xml',
    languages: XML_LANGUAGES,
    aliases: ['compress xml'],
    validate: (input) => /^\s*</.test(input),
    detect: isLikelyXml,
    diagnose: diagnoseWith(validateXml),
    run: minifyXml,
  }),
  formatOperation({
    id: 'format.yaml-beautify',
    name: 'Beautify YAML',
    description: 'Normalize YAML indentation (comments are kept). Invalid YAML is never changed; use Repair YAML.',
    language: 'yaml',
    languages: YAML_LANGUAGES,
    aliases: ['prettify yaml', 'format yml'],
    validate: looksLikeYamlNotOther,
    detect: isYaml,
    diagnose: diagnoseWith(validateYaml),
    run: formatYaml,
  }),
  formatOperation({
    id: 'format.yaml-minify',
    name: 'Minify YAML',
    description: 'Rewrite YAML in compact flow style.',
    language: 'yaml',
    languages: YAML_LANGUAGES,
    aliases: ['compress yaml', 'flow yaml'],
    validate: looksLikeYamlNotOther,
    detect: isYaml,
    diagnose: diagnoseWith(validateYaml),
    potentiallyLossy: true,
    lossyWarning: 'Comments, anchors, aliases and tags are not preserved in flow style.',
    run: minifyYaml,
  }),
  formatOperation({
    id: 'format.yaml-repair',
    name: 'Repair YAML',
    description: 'Guess and fix common indentation damage in pasted YAML. Always review the preview.',
    language: 'yaml',
    languages: YAML_LANGUAGES,
    aliases: ['fix yaml', 'yaml indentation'],
    validate: looksLikeYamlNotOther,
    potentiallyLossy: true,
    lossyWarning: 'Repair guesses the intended structure from indentation and may restructure data. Check the preview.',
    run: repairYaml,
  }),
];

function validationReport(label, result) {
  if (result.valid) return `✅ Valid ${label}`;
  return `❌ ${result.message}`;
}

export const validationOperations = [
  ['json', 'JSON', validateJson],
  ['yaml', 'YAML', validateYaml],
  ['xml', 'XML', validateXml],
].map(([format, label, validator]) =>
  defineOperation({
    id: `validate.${format}`,
    name: `Validate ${label}`,
    description: `Check ${label} syntax and report the line and column of the first error.`,
    category: 'Validate',
    inputType: format,
    outputType: 'text',
    outputMode: 'report',
    aliases: [`lint ${format}`, `check ${format}`],
    run: (input) => validationReport(label, validator(input)),
  }),
);
