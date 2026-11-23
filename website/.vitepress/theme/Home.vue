<script setup>
import { withBase } from 'vitepress'
import HomeIcon from './HomeIcon.vue'

const guide = path => withBase(`/guide/${path}.html`)
const github = 'https://github.com/zzusp/night-bot'
const workGuide = guide('usage') + '#记忆、技能与定时工作'
const capabilities = [
  { icon: 'task', label: '任务', title: '任务', text: '发句话，或把文件、截图发过来。要求改了，就在原任务里补一句。进度和结果也在那儿看。', link: guide('usage') + '#发起任务与补充信息', action: '怎么跟进任务' },
  { icon: 'channel', label: '渠道', title: '渠道', text: '除了网页，也能接入你常用的渠道。可以自己写渠道插件，各个渠道的聊天记录分开。', link: guide('channels'), action: '怎么接入渠道' },
  { icon: 'time', label: '定时', title: '定时任务', text: '可以让 Bot 明早提醒一次，也可以让它每周五整理周报。什么时候跑，打开「定时任务」就能看到。', link: workGuide, action: '怎么设定时任务' },
  { icon: 'memory', label: '记忆', title: '记忆', text: '比如你说「周报先写结论」，Bot 可以记住，下次写周报时照着来。记错了也能改。', link: workGuide, action: '记忆怎么用' },
  { icon: 'skill', label: 'Skills', title: 'Skills', text: '把常做的事写成一套步骤，比如排查服务日志。可以用自带的技能，也可以自己写。', link: workGuide, action: '技能怎么用' },
  { icon: 'evolution', label: '自进化', title: '自进化', text: '做完后回头看看，哪些办法确实管用，哪些路走不通。下次还用得上的就记下来，或者更新 Bot 自己的技能。', link: github + '/blob/main/docs/SELF-EVOLUTION.md', action: '复盘怎么做', external: true }
]
const comparisons = [
  { name: 'Night Bot', href: guide('usage'), use: '让自己的 Bot 接任务', notes: '可以接自定义渠道。每个任务都有执行记录，做完还能复盘，把有用的经验写进记忆或 Skills。' },
  { name: 'OpenClaw', href: 'https://docs.openclaw.ai/start/openclaw', use: '在常用聊天软件里用个人助手', notes: '自己部署 Gateway，把聊天软件和 AI 助手接起来。' },
  { name: 'Harness AI', href: 'https://github.com/harness-home/harness-ai-desktop', use: '在桌面上交给 Agent 做事', notes: '桌面端内置 DeepSeek Harness。离开电脑后，也能在手机上看记录、批操作。' },
  { name: 'DeepSeek Harness', href: 'https://www.deepseek.com/harness/en/', use: '运行或开发自己的 Agent', notes: '可以用桌面版，也可以接进自己的程序；用插件扩展能力。' },
  { name: '钉钉群自定义机器人', href: 'https://open.dingtalk.com/document/group/custom-robot-access', use: '往群里发通知', notes: '用 Webhook 把告警、日报等推到钉钉群。这里比较的是群 Webhook，不是钉钉里的所有机器人。' }
]
const faq = [
  { title: '需要先装 Pi CLI 吗？', text: '不用。准备好 Git、Node.js 24 或以上版本、pnpm，再准备一个能用的模型服务就行。', link: guide('installation'), action: '查看安装要求' },
  { title: '能用我自己的模型吗？', text: '可以。用你自己的 API 地址和密钥，不用另外开个 Night Bot 账号。', link: guide('configuration'), action: '怎么配置模型' },
  { title: '聊天记录和文件存在哪？', text: '聊天记录、文件和记忆都存在你装 Night Bot 的电脑或服务器上。用在线模型时，请求会发给你选的模型服务。', link: guide('security'), action: '数据和权限说明' }
]
</script>

<template>
  <div class="nb-home">
    <section class="nb-hero" aria-labelledby="home-title">
      <div class="nb-orbit" aria-hidden="true">
        <svg class="nb-orbit-paths" viewBox="0 0 560 240" fill="none" focusable="false">
          <ellipse cx="280" cy="120" rx="237" ry="80" transform="rotate(-11 280 120)" />
          <ellipse cx="280" cy="120" rx="171" ry="57" transform="rotate(17 280 120)" />
          <circle class="nb-orbit-spark" cx="447" cy="73" r="4" />
          <circle class="nb-orbit-spark" cx="127" cy="153" r="3" />
          <circle class="nb-orbit-spark" cx="347" cy="193" r="3" />
        </svg>
        <div class="nb-moon">
          <svg viewBox="0 0 48 48" fill="currentColor" focusable="false">
            <path d="M34 29A15 15 0 0 1 19 10a15 15 0 1 0 15 19Z" />
            <path d="m33 10 1.3 3.7L38 15l-3.7 1.3L33 20l-1.3-3.7L28 15l3.7-1.3Z" />
          </svg>
        </div>
        <span v-for="item in capabilities" :key="item.icon" :class="['nb-orbit-node', `nb-orbit-${item.icon}`]">
          <HomeIcon :name="item.icon" />
          {{ item.label }}
        </span>
      </div>
      <p class="nb-eyebrow">开源，可自己安装</p>
      <h1 id="home-title">Night Bot</h1>
      <p class="nb-tagline">在自己的电脑或服务器上跑的 AI 助手</p>
      <p class="nb-lead">用自己的模型，在网页或你接入的渠道里交代任务。做完有记录，下次还能用上这次的经验。</p>
      <div class="nb-actions">
        <a class="nb-button nb-button-primary" :href="guide('getting-started')">安装指南 <HomeIcon name="arrow" /></a>
        <a class="nb-button nb-button-secondary" :href="github">看源码 <HomeIcon name="external" /></a>
      </div>
    </section>

    <section class="nb-story" aria-labelledby="story-title">
      <div class="nb-story-copy">
        <h2 id="story-title">复盘任务，<br>完成自进化。</h2>
        <p>任务做完后，Bot 会回看执行记录。只有确认过、下次还能用上的做法，才值得记下来或写进 Skill。</p>
        <a class="nb-text-link" :href="github + '/blob/main/docs/SELF-EVOLUTION.md'">看复盘怎么做 <HomeIcon name="external" /></a>
      </div>
      <figure class="nb-demo">
        <div class="nb-demo-top">
          <img :src="withBase('/favicon.svg')" alt="" width="26" height="26">
          <strong>复盘：排查服务日志</strong>
          <span>示例</span>
        </div>
        <ol class="nb-review">
          <li><HomeIcon name="check" /><div><strong>任务做完了</strong><p>在对应服务的日志里找到了报错。</p></div></li>
          <li><HomeIcon name="memory" /><div><strong>这次学到什么</strong><p>别只凭名字找 Pod，先确认是哪一个服务。</p></div></li>
          <li><HomeIcon name="skill" /><div><strong>更新「排查服务日志」Skill</strong><p>下次先确认命名空间和 Service，再找对应的 Pod。</p></div></li>
        </ol>
      </figure>
    </section>

    <section class="nb-section" aria-labelledby="capabilities-title">
      <h2 id="capabilities-title">Night Bot 能做什么？</h2>
      <div class="nb-capabilities">
        <article v-for="item in capabilities" :key="item.title">
          <HomeIcon class="nb-feature-mark" :name="item.icon" />
          <h3>{{ item.title }}</h3><p>{{ item.text }}</p>
          <a class="nb-text-link" :href="item.link">{{ item.action }} <HomeIcon :name="item.external ? 'external' : 'arrow'" /></a>
        </article>
      </div>
    </section>

    <section class="nb-section nb-advantages" aria-labelledby="advantages-title">
      <h2 id="advantages-title">为什么用 Night Bot？</h2>
      <dl>
        <div><dt>轻量，好部署</dt><dd>核心服务可以单独运行，不用另装 Pi CLI。先连上自己的模型，网页和渠道用到再开。</dd></div>
        <div><dt>流程简单，不只用来写代码</dt><dd>整理资料、排查问题、设定时任务，都在你选的入口交代。一个任务一个会话，要改要求就回原任务补一句。</dd></div>
        <div><dt>做完有结果，下次还能用</dt><dd>材料、过程和产物都留在原任务。做完再复盘，确认管用的做法可以记下来，也可以更新成 Skill。</dd></div>
      </dl>
    </section>

    <section class="nb-section nb-compare" aria-labelledby="compare-title">
      <h2 id="compare-title">和其他工具怎么选？</h2>
      <p>先看你想做什么：接任务、搭助手、开发 Agent，还是往群里发通知。</p>
      <table aria-labelledby="compare-title">
        <thead><tr><th scope="col">工具</th><th scope="col">适合做什么</th><th scope="col">怎么用</th></tr></thead>
        <tbody>
          <tr v-for="item in comparisons" :key="item.name">
            <th scope="row"><a class="nb-text-link" :href="item.href">{{ item.name }}</a></th>
            <td>{{ item.use }}</td><td>{{ item.notes }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="nb-section nb-faq" aria-labelledby="faq-title">
      <div><h2 id="faq-title">常见问题</h2></div>
      <div class="nb-answers">
        <details v-for="item in faq" :key="item.title">
          <summary>{{ item.title }} <span aria-hidden="true"></span></summary>
          <p>{{ item.text }}</p>
          <a class="nb-text-link" :href="item.link">{{ item.action }} <HomeIcon name="arrow" /></a>
        </details>
      </div>
    </section>

    <section class="nb-closing" aria-labelledby="start-title">
      <h2 id="start-title">搭建自己的 Night Bot</h2>
      <p>按文档安装，连上自己的模型，再试一个小任务。</p>
      <a class="nb-button nb-button-primary" :href="guide('getting-started')">打开快速开始 <HomeIcon name="arrow" /></a>
      <p class="nb-safety">默认情况下，启动 Night Bot 的账号能访问什么，Bot 就能访问什么。建议用权限较少的账号运行，不要把控制台直接开放到公网。<a class="nb-text-link" :href="guide('security')">先看权限说明</a></p>
    </section>
  </div>
</template>
