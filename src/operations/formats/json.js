// Token-based JSON tools. Values are never re-serialized, so large integers (12345678901234567890),
// number spelling (1.0, 1e3), and duplicate keys are preserved exactly.

export const JSON_INDENT = 4;

export function lineColumnAt(text, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export class JsonSyntaxError extends SyntaxError {
  constructor(message, text, index) {
    const { line, column } = lineColumnAt(text, index);
    super(`Invalid JSON at line ${line}, column ${column}: ${message}`);
    this.name = 'JsonSyntaxError';
    this.line = line;
    this.column = column;
    this.index = index;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const WHITESPACE = /[ \t\n\r]+/y;

function lex(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    WHITESPACE.lastIndex = index;
    if (WHITESPACE.test(text)) {
      index = WHITESPACE.lastIndex;
      continue;
    }
    const char = text[index];
    if ('{}[]:,'.includes(char)) {
      tokens.push({ type: char, value: char, start: index });
      index += 1;
      continue;
    }
    if (char === '"') {
      STRING.lastIndex = index;
      const match = STRING.exec(text);
      if (!match) throw new JsonSyntaxError('unterminated or invalid string', text, index);
      tokens.push({ type: 'string', value: match[0], start: index });
      index = STRING.lastIndex;
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(text);
      if (!match) throw new JsonSyntaxError('invalid number', text, index);
      tokens.push({ type: 'number', value: match[0], start: index });
      index = NUMBER.lastIndex;
      continue;
    }
    const literal = ['true', 'false', 'null'].find((word) => text.startsWith(word, index));
    if (literal) {
      tokens.push({ type: 'literal', value: literal, start: index });
      index += literal.length;
      continue;
    }
    throw new JsonSyntaxError(`unexpected character ${JSON.stringify(char)}`, text, index);
  }
  return tokens;
}

/** Lex and structurally validate JSON. Returns the token list; throws JsonSyntaxError with line/column. */
export function tokenizeJsonStrict(input) {
  const text = String(input);
  const tokens = lex(text);
  let position = 0;
  const peek = () => tokens[position];
  const fail = (message) => {
    const token = peek();
    throw new JsonSyntaxError(message, text, token ? token.start : text.length);
  };
  const expect = (type) => {
    if (peek()?.type !== type)
      fail(`expected '${type}'${peek() ? ` but found '${peek().value}'` : ' but reached the end'}`);
    position += 1;
  };

  const parseValue = (depth) => {
    if (depth > 512) fail('nesting is too deep');
    const token = peek();
    if (!token) fail('unexpected end of input');
    if (token.type === '{') {
      position += 1;
      if (peek()?.type === '}') {
        position += 1;
        return;
      }
      for (;;) {
        if (peek()?.type !== 'string') fail('expected a property name in double quotes');
        position += 1;
        expect(':');
        parseValue(depth + 1);
        if (peek()?.type === ',') {
          position += 1;
          continue;
        }
        expect('}');
        return;
      }
    }
    if (token.type === '[') {
      position += 1;
      if (peek()?.type === ']') {
        position += 1;
        return;
      }
      for (;;) {
        parseValue(depth + 1);
        if (peek()?.type === ',') {
          position += 1;
          continue;
        }
        expect(']');
        return;
      }
    }
    if (['string', 'number', 'literal'].includes(token.type)) {
      position += 1;
      return;
    }
    fail(`unexpected '${token.value}'`);
  };

  if (tokens.length === 0) throw new JsonSyntaxError('input is empty', text, 0);
  parseValue(0);
  if (position < tokens.length) fail(`unexpected '${peek().value}' after the end of the value`);
  return tokens;
}

export function validateJson(text) {
  try {
    tokenizeJsonStrict(text);
    return { valid: true };
  } catch (error) {
    return { valid: false, message: error.message, line: error.line, column: error.column };
  }
}

export function isLikelyJson(code) {
  const text = String(code).trim();
  if (!text || !/^[{[]/.test(text)) return false;
  return validateJson(text).valid;
}

export function formatJson(json, indent = JSON_INDENT) {
  const tokens = tokenizeJsonStrict(String(json).trim());
  const pad = typeof indent === 'string' ? indent : ' '.repeat(indent);
  let depth = 0;
  let output = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    switch (token.type) {
      case '{':
      case '[': {
        const closing = token.type === '{' ? '}' : ']';
        if (tokens[i + 1]?.type === closing) {
          output += token.value + closing;
          i += 1;
        } else {
          depth += 1;
          output += `${token.value}\n${pad.repeat(depth)}`;
        }
        break;
      }
      case '}':
      case ']':
        depth -= 1;
        output += `\n${pad.repeat(depth)}${token.value}`;
        break;
      case ',':
        output += `,\n${pad.repeat(depth)}`;
        break;
      case ':':
        output += ': ';
        break;
      default:
        output += token.value;
    }
  }
  return output;
}

export function minifyJson(json) {
  return tokenizeJsonStrict(String(json).trim())
    .map((token) => token.value)
    .join('');
}

/** Parse JSON with a helpful line/column error. Values follow JSON.parse semantics. */
export function parseJson(text) {
  tokenizeJsonStrict(String(text).trim());
  return JSON.parse(String(text).trim());
}

/** True when JSON contains integers that JSON.parse cannot represent exactly. */
export function hasUnsafeNumbers(text) {
  return tokenizeJsonStrict(String(text).trim()).some((token) => {
    if (token.type !== 'number') return false;
    if (/[.eE]/.test(token.value)) return false;
    return !Number.isSafeInteger(Number(token.value));
  });
}

/** Recursively sort object keys. */
export function sortJsonKeys(value, { descending = false } = {}) {
  if (Array.isArray(value)) return value.map((item) => sortJsonKeys(item, { descending }));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)));
    return Object.fromEntries(keys.map((key) => [key, sortJsonKeys(value[key], { descending })]));
  }
  return value;
}
