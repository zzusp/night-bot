import DefaultTheme from 'vitepress/theme-without-fonts'
import Layout from './Layout.vue'
import '../../../packages/web-console/src/styles/boardui.css'
import './style.css'

export default { extends: DefaultTheme, Layout }
