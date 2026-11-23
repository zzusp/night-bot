import DefaultTheme from 'vitepress/theme-without-fonts'
import Layout from './Layout.vue'
import '../../../packages/web-console/src/styles/boardui.css'
import './style.css'
import './home.css'

export default { extends: DefaultTheme, Layout }
