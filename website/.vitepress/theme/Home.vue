<script setup>
import { withBase } from 'vitepress'

const guides = [
  { title: '安装与配置', text: '准备运行环境，连接自己的模型服务。', link: '/guide/installation', label: '从环境准备开始' },
  { title: '接入渠道', text: '先用 Web 对话，再按需接入钉钉或自定义插件。', link: '/guide/channels', label: '选择协作入口' },
  { title: '日常使用', text: '交代任务、补充要求，查看结果与学习记录。', link: '/guide/usage', label: '了解协作方式' }
]
</script>

<template>
  <div class="nb-home">
    <section class="nb-hero" aria-labelledby="home-title">
      <div class="nb-intro">
        <p class="nb-eyebrow">自己的环境 · 自己的个人助理</p>
        <h1 id="home-title">把事情交给 Bot，<br><span>让工作继续。</span></h1>
        <p class="nb-lead">Night Bot 是基于 Pi 的个人助理 Agent 初始化套件。把任务执行、长期记忆、技能学习和定时工作，放进你自己的运行环境。</p>
        <div class="nb-actions">
          <a class="nb-button nb-button-primary" :href="withBase('/guide/getting-started.html')">开始搭建 <span aria-hidden="true">↗</span></a>
          <a class="nb-button nb-button-secondary" href="https://github.com/zzusp/night-bot">查看源码 <span aria-hidden="true">↗</span></a>
        </div>
        <p class="nb-requirements">Node.js 24+ <span aria-hidden="true">/</span> pnpm 11.25.0 <span aria-hidden="true">/</span> 自备模型服务</p>
      </div>
      <figure class="nb-thread" aria-labelledby="thread-caption">
        <div class="nb-thread-heading"><img :src="withBase('/favicon.svg')" alt="" width="28" height="28"><strong>Night Bot</strong><span>协作示意</span></div>
        <div class="nb-message nb-message-user"><span class="nb-speaker">你</span><p>帮我整理这些资料，做一份对比报告。</p></div>
        <div class="nb-message nb-message-bot"><span class="nb-speaker">Bot</span><p>把要求接住，让任务、结果和后续补充留在同一个工作脉络里。</p></div>
        <ol class="nb-task-thread" aria-label="协作流程示意">
          <li><span class="nb-thread-dot" aria-hidden="true"></span><div><strong>任务执行</strong><p>资料、工作文件和产物集中归档</p></div></li>
          <li><span class="nb-thread-dot" aria-hidden="true"></span><div><strong>持续协作</strong><p>补充要求，跟进等待和执行记录</p></div></li>
          <li><span class="nb-thread-dot" aria-hidden="true"></span><div><strong>复盘与学习</strong><p>根据证据沉淀记忆和可复用技能</p></div></li>
        </ol>
        <figcaption id="thread-caption">能力示意，不是实时对话或任务状态。</figcaption>
      </figure>
    </section>

    <section class="nb-principles" aria-label="运行方式">
      <div><span>运行在你这里</span><strong>数据与工作区留在自己的安装中</strong></div>
      <div><span>入口按需选择</span><strong>Web、钉钉与自定义渠道插件</strong></div>
      <div><span>模型由你配置</span><strong>分诊、Router、任务分别选择</strong></div>
    </section>

    <section class="nb-section" aria-labelledby="capabilities-title">
      <div class="nb-section-header"><p class="nb-eyebrow">从一次对话，到持续协作</p><h2 id="capabilities-title">不止回答，<br>也把过程接起来。</h2></div>
      <div class="nb-capabilities">
        <article><h3>事情有来处，也有去向</h3><p>每个事项保留一个执行会话，支持补充输入、等待、依赖和恢复。任务结束后的动作，仍需要对应授权。</p><a :href="withBase('/guide/usage.html')">了解任务与记录 <span aria-hidden="true">→</span></a></article>
        <article><h3>记住经验，不凭空记住结论</h3><p>共享长期记忆保留来源，支持纠正与忘记。任务复盘可提炼受管 Skills，不改写你安装的正式技能。</p><a :href="withBase('/guide/usage.html')">了解记忆与学习 <span aria-hidden="true">→</span></a></article>
        <article><h3>到时间，继续已经安排的工作</h3><p>支持单次、间隔、每日、每周和 cron 排期。持久化保存安排，周期事项在恢复时合并错过的轮次。</p><a :href="withBase('/guide/usage.html')">了解定时工作 <span aria-hidden="true">→</span></a></article>
      </div>
    </section>

    <section class="nb-guides" aria-labelledby="guides-title">
      <div class="nb-guides-heading"><h2 id="guides-title">从这里开始</h2><a :href="withBase('/reference/index.html')">查看参考资料 <span aria-hidden="true">→</span></a></div>
      <div class="nb-guide-grid"><a v-for="guide in guides" :key="guide.link" class="nb-guide" :href="withBase(`${guide.link}.html`)"><span class="nb-guide-label">{{ guide.label }}</span><h3>{{ guide.title }} <span aria-hidden="true">↗</span></h3><p>{{ guide.text }}</p></a></div>
    </section>

    <aside class="nb-safety" aria-label="开始前的权限提醒"><strong>先了解运行边界</strong><p>新安装默认 full（完全访问），工具按启动 Bot 的操作系统账号权限执行，不提供工作区或进程隔离。Web 控制台面向本机单个操作者，不应直接暴露公网。</p><a :href="withBase('/guide/security.html')">阅读权限与数据安全 <span aria-hidden="true">→</span></a></aside>
  </div>
</template>
