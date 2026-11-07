// The panel and its workflows are plain files, and a malformed one fails silently (an agent that never loads). Guard the shape,
// and guard the references: every path and npm script an agent or a skill names has to exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
const TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'Agent', 'WebFetch', 'WebSearch'];

function frontmatter(path) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(read(path));
  assert.ok(m, `${path}: no frontmatter`);
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    assert.ok(kv, `${path}: not a “key: value” line: ${line.slice(0, 60)}`);
    const [, k, v] = kv;
    if (v.startsWith('"')) {
      assert.ok(v.length > 1 && v.endsWith('"') && !/(^|[^\\])"/.test(v.slice(1, -1)), `${path}: ${k} has a bad quoted string`);
    } else {
      assert.ok(!/: /.test(v) && !/ #/.test(v), `${path}: ${k} is unquoted and contains “: ” or “ #”, which YAML reads as a mapping or a comment: quote it`);
    }
    fields[k] = v.replace(/^"|"$/g, '');
  }
  return { fields, body: m[2] };
}

const agents = readdirSync(join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md'));
const skills = readdirSync(join(ROOT, '.claude/skills'));

test('the eight specialists are all there', () => {
  assert.deepEqual(agents.map((f) => f.replace(/\.md$/, '')).sort(), ['access-lead', 'art-director', 'content-designer', 'craft-engineer', 'motion-director', 'owner-advocate', 'persona-voice', 'ux-architect']);
});

test('every agent has a valid frontmatter, a name that matches its file, read-only tools and a known colour', () => {
  for (const f of agents) {
    const { fields, body } = frontmatter(`.claude/agents/${f}`);
    assert.equal(fields.name, f.replace(/\.md$/, ''));
    assert.ok(fields.description.length > 80, `${f}: the description is what decides when it is used`);
    assert.ok(COLORS.includes(fields.color), `${f}: colour ${fields.color}`);
    const tools = fields.tools.split(',').map((t) => t.trim());
    assert.ok(tools.every((t) => TOOLS.includes(t)), `${f}: ${tools}`);
    assert.ok(!tools.some((t) => ['Write', 'Edit', 'Bash'].includes(t)), `${f}: a critic is read-only`);
    assert.match(body, /panel-protocol\.md/, `${f}: every critic follows the protocol`);
  }
});

test('every skill has a valid frontmatter, a name that matches its folder, and stays short enough to read', () => {
  for (const d of skills) {
    const path = `.claude/skills/${d}/SKILL.md`;
    const { fields, body } = frontmatter(path);
    assert.equal(fields.name, d);
    assert.ok(fields.description.length > 80);
    assert.ok(body.split('\n').length < 500, `${d}: keep SKILL.md under 500 lines`);
    if (fields['argument-hint']) assert.match(body, /\$ARGUMENTS/, `${d}: it declares an argument and never uses it`);
  }
  assert.deepEqual([...skills].sort(), ['cabinet', 'cabinet-impact', 'cabinet-learn', 'cabinet-walk']);
});

test('what the heavy workflow can run is never pre-approved by accident', () => {
  const { fields } = frontmatter('.claude/skills/cabinet/SKILL.md');
  assert.equal(fields['disable-model-invocation'], 'true', '/cabinet spends minutes and many agents: the user starts it');
  assert.ok(!fields['allowed-tools'], '/cabinet must not pre-approve Bash or Agent');
  assert.equal(frontmatter('.claude/skills/cabinet-impact/SKILL.md').fields['allowed-tools'], 'Read Grep Glob', '/cabinet-impact stays read-only');
});

test('every file path and every npm script that the team names exists', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const files = [...agents.map((f) => `.claude/agents/${f}`), ...skills.map((d) => `.claude/skills/${d}/SKILL.md`), 'CLAUDE.md', 'design/README.md'];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/`(design\/[A-Za-z0-9_./-]+?\.(?:md|mjs|json))`/g)) assert.ok(existsSync(join(ROOT, m[1])), `${f} mentions ${m[1]}, which does not exist`);
    for (const m of text.matchAll(/npm run (ux[\w:-]*)/g)) assert.ok(scripts[m[1]], `${f} runs “npm run ${m[1]}”, which is not a script`);
  }
});
