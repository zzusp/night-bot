import { h } from 'vue'
import DefaultTheme from 'vitepress/theme-without-fonts'
import Home from './Home.vue'
import '../../../packages/web-console/src/styles/boardui.css'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-before': () => h(Home) })
}
