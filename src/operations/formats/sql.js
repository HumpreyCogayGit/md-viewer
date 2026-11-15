export const SQL_LANGUAGES = Object.freeze([
  'sql',
  'mysql',
  'postgresql',
  'postgres',
  'pgsql',
  'sqlite',
  'plsql',
  'tsql',
  'mssql',
]);

const SQL_KEYWORDS = new Set([
  'ADD',
  'ALL',
  'ALTER',
  'AND',
  'AS',
  'ASC',
  'BEGIN',
  'BETWEEN',
  'BY',
  'CASE',
  'CHECK',
  'COLUMN',
  'COMMIT',
  'CONSTRAINT',
  'CREATE',
  'CROSS',
  'DATABASE',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DISTINCT',
  'DROP',
  'ELSE',
  'END',
  'EXISTS',
  'FALSE',
  'FOREIGN',
  'FROM',
  'FULL',
  'GROUP',
  'HAVING',
  'IN',
  'INNER',
  'INSERT',
  'INTO',
  'IS',
  'JOIN',
  'KEY',
  'LEFT',
  'LIKE',
  'LIMIT',
  'NOT',
  'NULL',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'PRIMARY',
  'REFERENCES',
  'RETURNING',
  'RIGHT',
  'ROLLBACK',
  'SELECT',
  'SET',
  'TABLE',
  'THEN',
  'TRUE',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'VALUES',
  'VIEW',
  'WHEN',
  'WHERE',
  'WITH',
]);

const SQL_FUNCTIONS = new Set([
  'AVG',
  'COALESCE',
  'COUNT',
  'DATE',
  'IFNULL',
  'LOWER',
  'MAX',
  'MIN',
  'NOW',
  'ROUND',
  'SUM',
  'UPPER',
]);

const SQL_CLAUSE_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'UNION',
  'UNION ALL',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE',
  'ALTER',
  'DROP',
  'VALUES',
  'SET',
  'RETURNING',
  'JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'RIGHT OUTER JOIN',
  'INNER JOIN',
  'FULL JOIN',
  'FULL OUTER JOIN',
  'CROSS JOIN',
  'ON',
  'WITH',
]);

const SQL_LINE_BREAK_KEYWORDS = new Set(['AND', 'OR', 'WHEN', 'ELSE']);

// Four spaces: deterministic across browsers (Safari renders tabs inconsistently in textareas).
export const SQL_INDENT = '    ';

// Multi-character operators are listed longest-first so they are never split into single characters.
const MULTI_CHAR_OPERATORS = [
  '->>',
  '<=>',
  '#>>',
  '||',
  '::',
  '->',
  ':=',
  '<>',
  '!=',
  '<=',
  '>=',
  '==',
  '<<',
  '>>',
  '#>',
  '@>',
  '<@',
  '&&',
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SQL_TOKEN = new RegExp(
  [
    '--[^\\n]*',
    '\\/\\*[\\s\\S]*?\\*\\/',
    "'(?:''|[^'])*'",
    '"(?:""|[^"])*"',
    '`[^`]*`',
    '\\$([A-Za-z_]\\w*)?\\$[\\s\\S]*?\\$\\1\\$', // dollar-quoted string
    '\\$\\d+', // positional parameter
    ...MULTI_CHAR_OPERATORS.map(escapeRegex), // before `:name` so `c::int` keeps its `::` cast
    ':[A-Za-z_]\\w*', // named parameter
    '@@?[A-Za-z_]\\w*', // named parameter / variable
    '\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b',
    '[A-Za-z_][\\w$]*',
    '[(),.;]',
    '[+\\-*/%=<>!~^&|?#]',
    '\\s+',
    '.',
  ].join('|'),
  'g',
);

const OPERATOR_PATTERN = new RegExp(`^(?:${MULTI_CHAR_OPERATORS.map(escapeRegex).join('|')}|[+\\-*/%=<>!~^&|?#])$`);

export function tokenizeSql(code) {
  SQL_TOKEN.lastIndex = 0;
  return Array.from(code.matchAll(SQL_TOKEN), ([value]) => {
    if (/^\s+$/.test(value)) return { type: 'space', value };
    if (/^(--|\/\*)/.test(value)) return { type: 'comment', value };
    if (/^['"`]/.test(value) || /^\$([A-Za-z_]\w*)?\$/.test(value)) return { type: 'string', value };
    if (/^(\$\d+|:[A-Za-z_]|@)/.test(value)) return { type: 'parameter', value };
    if (/^\d/.test(value)) return { type: 'number', value };
    if (/^[A-Za-z_]/.test(value)) {
      const upper = value.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) return { type: 'keyword', value: upper };
      if (SQL_FUNCTIONS.has(upper)) return { type: 'function', value: upper };
      return { type: 'identifier', value };
    }
    if (/^[(),.;]$/.test(value)) return { type: 'punctuation', value };
    if (OPERATOR_PATTERN.test(value)) return { type: 'operator', value };
    return { type: 'plain', value };
  });
}

const tokenValue = (token) =>
  token.type === 'keyword' || token.type === 'function' ? token.value.toUpperCase() : token.value;

export function isLikelySql(code) {
  const text = String(code).trim();
  if (!text) return false;

  const tokens = tokenizeSql(text).filter((token) => token.type !== 'space');
  const keywordCount = tokens.filter((token) => token.type === 'keyword').length;
  const firstToken = tokens[0];
  const firstKeyword = tokens.find((token) => token.type === 'keyword')?.value;
  const hasCoreClause = tokens.some((token) =>
    ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'CREATE', 'ALTER'].includes(token.value),
  );
  const hasRelationalClause = tokens.some((token) =>
    ['FROM', 'JOIN', 'WHERE', 'GROUP', 'ORDER', 'SET', 'VALUES', 'TABLE', 'INTO'].includes(token.value),
  );
  // Prose rarely starts with a statement keyword; SQL almost always does (or with a comment / parenthesis).
  const startsLikeStatement =
    firstToken &&
    ([
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'WITH',
      'CREATE',
      'ALTER',
      'DROP',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ].includes(firstToken.value) ||
      firstToken.type === 'comment' ||
      firstToken.value === '(');

  return Boolean(
    startsLikeStatement &&
    keywordCount >= 2 &&
    hasCoreClause &&
    (hasRelationalClause || ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER'].includes(firstKeyword)),
  );
}

export function formatSql(sql) {
  const tokens = tokenizeSql(String(sql).trim()).filter((token) => token.type !== 'space');
  if (tokens.length === 0) return '';

  const lines = [];
  let indentLevel = 0;
  let contentIndent = 0;
  let skipCount = 0;
  const parenStack = [];

  const getClause = (index) => {
    const first = tokenValue(tokens[index]);
    const second = tokens[index + 1] ? tokenValue(tokens[index + 1]) : '';
    const third = tokens[index + 2] ? tokenValue(tokens[index + 2]) : '';
    const threeWord = `${first} ${second} ${third}`;
    const twoWord = `${first} ${second}`;
    if (SQL_CLAUSE_KEYWORDS.has(threeWord)) return { value: threeWord, consumed: 3 };
    if (SQL_CLAUSE_KEYWORDS.has(twoWord)) return { value: twoWord, consumed: 2 };
    if (SQL_CLAUSE_KEYWORDS.has(first)) return { value: first, consumed: 1 };
    return null;
  };

  const currentLine = () => lines[lines.length - 1] || '';
  const setCurrentLine = (value) => {
    if (lines.length === 0) lines.push(value);
    else lines[lines.length - 1] = value;
  };
  const newLine = (indent = contentIndent) => {
    if (lines.length > 0) setCurrentLine(currentLine().trimEnd());
    lines.push(SQL_INDENT.repeat(Math.max(indent, 0)));
  };
  let previousToken = null;
  const append = (value, { noLeadingSpace = false } = {}) => {
    if (lines.length === 0) newLine(0);
    const line = currentLine();
    const hasContent = line.trim().length > 0;
    const baseLine = hasContent ? line.trimEnd() : line;
    const lastChar = baseLine.slice(-1);
    const tight = value === '::' || previousToken?.value === '::' || value === '.' || previousToken?.value === '.';
    const needsSpace = hasContent && !noLeadingSpace && !tight && !/[\s(]/.test(lastChar) && !/^[),;]$/.test(value);
    setCurrentLine(baseLine + (needsSpace ? ' ' : '') + value);
  };
  const hasOpenExpressionParen = () => parenStack.some((entry) => entry === 'expr');
  const clauseLineIndent = (clause) => (clause === 'ON' ? indentLevel + 1 : indentLevel);
  const clauseContentIndent = (clause, lineIndent) => (clause.startsWith('UNION') ? lineIndent : lineIndent + 1);

  tokens.forEach((token, index) => {
    if (skipCount > 0) {
      skipCount -= 1;
      return;
    }

    const value = tokenValue(token);
    const nextValue = tokens[index + 1] ? tokenValue(tokens[index + 1]) : '';
    const finish = () => {
      previousToken = token;
    };

    if (token.type === 'comment') {
      if (currentLine().trim() !== '') newLine();
      append(value, { noLeadingSpace: true });
      newLine();
      return finish();
    }

    if (value === '(') {
      const startsSubquery = nextValue === 'SELECT' || nextValue === 'WITH';
      const previousIsCallable = previousToken && ['function', 'identifier'].includes(previousToken.type);
      append(value, { noLeadingSpace: previousIsCallable });
      if (startsSubquery) {
        parenStack.push('subquery');
        indentLevel += 1;
        contentIndent = indentLevel;
        newLine(indentLevel);
      } else {
        parenStack.push('expr');
      }
      return finish();
    }

    if (value === ')') {
      const parenType = parenStack.pop();
      if (parenType === 'subquery') {
        indentLevel = Math.max(indentLevel - 1, 0);
        contentIndent = indentLevel + 1;
        if (currentLine().trim() !== '') newLine(indentLevel);
      }
      append(value, { noLeadingSpace: true });
      return finish();
    }

    if (value === ',') {
      append(value, { noLeadingSpace: true });
      if (!hasOpenExpressionParen()) newLine(contentIndent);
      return finish();
    }

    if (value === ';') {
      append(value, { noLeadingSpace: true });
      contentIndent = 0;
      indentLevel = 0;
      newLine(0);
      return finish();
    }

    if (token.type === 'keyword') {
      if (value === 'CASE') {
        if (currentLine().trim() !== '' && !currentLine().trimEnd().endsWith('(')) newLine(contentIndent);
        append(value);
        return finish();
      }
      if (value === 'WHEN' || value === 'ELSE') {
        if (currentLine().trim() !== '') newLine(contentIndent + 1);
        append(value, { noLeadingSpace: true });
        return finish();
      }
      if (value === 'END') {
        if (currentLine().trim() !== '') newLine(contentIndent);
        append(value, { noLeadingSpace: true });
        return finish();
      }

      const clause = getClause(index);
      if (clause) {
        const lineIndent = clauseLineIndent(clause.value);
        if (currentLine().trim() !== '') newLine(lineIndent);
        append(clause.value, { noLeadingSpace: true });
        contentIndent = clauseContentIndent(clause.value, lineIndent);
        skipCount = clause.consumed - 1;
        newLine(contentIndent);
        return finish();
      }

      if (SQL_LINE_BREAK_KEYWORDS.has(value) && currentLine().trim() !== '') newLine(contentIndent);
    }

    append(value);
    return finish();
  });

  return lines
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.trim() !== '' || (index > 0 && index < all.length - 1))
    .join('\n')
    .trim();
}

export function minifySql(sql) {
  const tokens = tokenizeSql(String(sql).trim()).filter((token) => token.type !== 'space');
  if (tokens.length === 0) return '';

  const isWordLike = (token) =>
    ['keyword', 'function', 'identifier', 'number', 'string', 'parameter'].includes(token.type);
  const needsSpace = (previous, current) => {
    if (!previous) return false;
    if (previous.type === 'comment' || current.type === 'comment') return true;
    const joined = previous.value.slice(-1) + current.value.slice(0, 1);
    // Never let two tokens fuse into a comment opener (`1 - -1` must not become `1--1`).
    if (joined === '--' || joined === '/*' || joined === '*/') return true;
    if (previous.type === 'operator' && current.type === 'operator') {
      // Keep separate operators separate so they are not re-read as one multi-character operator.
      return OPERATOR_PATTERN.test(previous.value + current.value) || OPERATOR_PATTERN.test(joined);
    }
    if (current.type === 'punctuation' && /^[),.;]$/.test(current.value)) return false;
    if (previous.type === 'punctuation' && /^[(.,]$/.test(previous.value)) return false;
    if (current.type === 'punctuation' && current.value === '(') return false;
    if (previous.type === 'operator' || current.type === 'operator') return false;
    return isWordLike(previous) && isWordLike(current);
  };

  return tokens
    .reduce((output, token, index) => {
      const previous = tokens[index - 1];
      const separator = needsSpace(previous, token) ? ' ' : '';
      const suffix = token.type === 'comment' && token.value.startsWith('--') ? '\n' : '';
      return `${output}${separator}${tokenValue(token)}${suffix}`;
    }, '')
    .replace(/\n /g, '\n')
    .trim();
}
