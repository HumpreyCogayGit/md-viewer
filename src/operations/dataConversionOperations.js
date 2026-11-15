import { defineOperation } from './registry.js';
import { DATA_FORMAT_LABELS, convertDataFormat, conversionWarning } from './formats/convert.js';
import { isLikelyDataFormat } from './formats/detect.js';
import { validateJson } from './formats/json.js';
import { XML_LANGUAGES, validateXml } from './formats/xml.js';
import { YAML_LANGUAGES, validateYaml } from './formats/yaml.js';

const VALIDATORS = { json: validateJson, xml: validateXml, yaml: validateYaml };

const CONVERSION_PAIRS = [
  ['json', 'xml'],
  ['json', 'yaml'],
  ['xml', 'json'],
  ['xml', 'yaml'],
  ['yaml', 'json'],
  ['yaml', 'xml'],
];

export const DATA_FORMAT_LANGUAGES = Object.freeze({
  json: new Set(['json']),
  xml: new Set(XML_LANGUAGES),
  yaml: new Set(YAML_LANGUAGES),
});

const ALIASES = { json: ['js object'], xml: ['markup'], yaml: ['yml'] };

/**
 * JSON/XML/YAML conversions in all six directions. Dependencies can be injected for tests; by default the pure
 * format modules are used.
 */
export function createDataConversionOperations({
  labels = DATA_FORMAT_LABELS,
  languages = DATA_FORMAT_LANGUAGES,
  validate = isLikelyDataFormat,
  convert = convertDataFormat,
} = {}) {
  return CONVERSION_PAIRS.map(([sourceFormat, targetFormat]) => {
    const sourceLabel = labels[sourceFormat];
    const targetLabel = labels[targetFormat];
    const potentiallyLossy = sourceFormat !== 'json' || targetFormat === 'xml';

    return defineOperation({
      id: `data.${sourceFormat}-to-${targetFormat}`,
      name: `${sourceLabel} → ${targetLabel}`,
      description: `Convert ${sourceLabel} data to ${targetLabel}.`,
      category: 'Structured Data',
      aliases: [
        `${sourceFormat} to ${targetFormat}`,
        `${sourceFormat}2${targetFormat}`,
        ...(ALIASES[sourceFormat] || []),
      ],
      inputType: sourceFormat,
      outputType: targetFormat,
      inputLanguages: Array.from(languages[sourceFormat] || []),
      outputLanguage: targetFormat,
      supportsFencedBlock: true,
      potentiallyLossy,
      lossyWarning: potentiallyLossy ? conversionWarning(sourceFormat, targetFormat) : undefined,
      inverse: `data.${targetFormat}-to-${sourceFormat}`,
      outputExtension: targetFormat,
      invalidInputMessage: `Invalid ${sourceLabel}. Please highlight valid ${sourceLabel} data first.`,
      noMatchingBlockMessage: `No valid ${sourceLabel} fenced code block found in the selection.`,
      validate: (input) => validate(input, sourceFormat),
      diagnose: (input) => {
        const result = VALIDATORS[sourceFormat]?.(input);
        return result && !result.valid ? result.message : undefined;
      },
      run: (input) => convert(input, sourceFormat, targetFormat),
    });
  });
}
