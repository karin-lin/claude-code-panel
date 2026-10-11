import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// 开源前的安全网：仓库里不能出现作者本人的私人信息、本机路径、私有工具名。
// 关键词用片段拼出来，免得这个测试文件自己成为泄露源；本文件自己不参与扫描。
const j = (...p) => p.join('')
const FORBIDDEN = [
  [j('kar', 'in(?!-lin)'), 'i'], [j('hualin', 'like'), 'i'], [j('yaphe', 'ts'), 'i'], [j('xuc', 'hao'), 'i'],
  [j('订单', '流'), ''], [j('小', '林'), ''], [j('ri', 'na-pet'), 'i'], [j('quota', '-guard'), 'i'], [j('Cow', 'ork'), 'i'],
  [j('\\bAr', 'in\\b'), 'i'], [j('Her', 'mes'), 'i'], [j('emotion', '-system'), 'i'],
  [j('/Us', 'ers/'), ''], [j('C:\\\\Us', 'ers'), 'i'], [j('/home/', 'karin'), 'i'],
  [j('sk-ant', '-'), ''], [j('Bearer ', '[A-Za-z0-9._-]{20,}'), ''], [j('gh', 'p_[A-Za-z0-9]{20,}'), '']
].map(([src, flags]) => new RegExp(src, flags))

const SKIP_DIRS = new Set(['node_modules', '.git'])
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.css', '.svg', '.txt', '.yml', '.yaml', ''])

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

test('仓库里没有个人信息、本机路径、私有工具名、密钥', () => {
  const self = path.resolve('tests/privacy.test.mjs')
  const hits = []
  for (const f of walk('.')) {
    if (path.resolve(f) === self) continue
    if (!TEXT_EXT.has(path.extname(f).toLowerCase()) && !/LICENSE$/.test(f)) continue
    const text = fs.readFileSync(f, 'utf8')
    for (const re of FORBIDDEN) { const m = text.match(re); if (m) hits.push(`${f}: ${m[0]}`) }
  }
  assert.deepEqual(hits, [], '发现疑似个人信息：\n' + hits.join('\n'))
})

test('二进制文件只有截图，且都在 docs/screenshots 下', () => {
  const bad = []
  for (const f of walk('.')) {
    const ext = path.extname(f).toLowerCase()
    if (['.png', '.jpg', '.jpeg', '.gif', '.zip', '.db', '.sqlite'].includes(ext) && !f.replace(/\\/g, '/').startsWith('docs/screenshots/') && !f.startsWith('./docs/screenshots/')) bad.push(f)
  }
  assert.deepEqual(bad, [])
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /^\*\.vsix$/m, '构建出来的安装包必须被 .gitignore 排除')
})

test('package.json / LICENSE：署名只能是公开的 GitHub 账号名', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const handle = 'karin' + '-lin'
  assert.equal(pkg.license, 'MIT'); assert.equal(pkg.publisher, handle); assert.equal(pkg.author, handle)
  assert.equal(pkg.repository.url, `https://github.com/${handle}/claude-code-panel.git`)
  assert.match(fs.readFileSync('LICENSE', 'utf8'), new RegExp(`Copyright \\(c\\) 2026 ${handle}\n`))
})
