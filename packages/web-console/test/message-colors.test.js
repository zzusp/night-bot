import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const css = readFileSync(new URL('../src/styles/boardui.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8')
const design = readFileSync(new URL('../../../DESIGN.md', import.meta.url), 'utf8')
const tokens = block => Object.fromEntries([...block.matchAll(/--board-([\w-]+):\s*(#[\da-f]{6});/g)].map(([, name, value]) => [name, value]))
const light = tokens(css.match(/:root \{([^}]+)\}/)[1])
const dark = {...light, ...tokens(css.match(/:root\[data-theme='dark'\], :root\.dark \{([^}]+)\}/)[1])}
function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return .2126 * r + .7152 * g + .0722 * b
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

for (const [theme, palette] of Object.entries({light, dark})) {
  test(`${theme}: shared blue user and neutral assistant fills and AA message text contrast`, () => {
    const expected = theme === 'light' ? ['#ccdfff', '#ffffff'] : ['#263b5c', '#262626']
    assert.deepEqual([palette['message-user-bg'], palette['message-assistant-bg']], expected)
    for (const role of ['user', 'assistant']) {
      const background = palette[`message-${role}-bg`]
      assert.notEqual(background, palette.panel, `${theme} bubble remains distinct from the conversation panel`)
      for (const text of ['text', 'message-muted', 'info']) {
        assert.ok(contrast(background, palette[text]) >= 4.5, `${theme} ${role} / ${text}`)
      }
      assert.equal(palette[`message-${role}-border`], undefined)
    }
  })
}

test('shared bubbles consume the documented tokens without changing other surfaces', () => {
  for (const [name, value] of Object.entries(light).filter(([name]) => name.startsWith('message-'))) {
    assert.ok(design.includes(`${name}: "${value}"`), `DESIGN.md mirror: ${name}`)
  }
  for (const role of ['user', 'assistant']) {
    assert.ok(app.includes(`.message-${role} .message-body { background: var(--board-message-${role}-bg); }`))
  }
  assert.ok(app.includes('--board-muted: var(--board-message-muted)'))
  assert.match(app, /\.message-user \.message-body,\.message-assistant \.message-body \{[^}]*padding: 13px 17px; border: 0; border-radius: 14px;/)
  assert.doesNotMatch(css + app, /--board-message-(?:user|assistant)-border/)
})
