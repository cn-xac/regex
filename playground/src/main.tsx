import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 两条 import 都不可省：前者是随包发布的产品皮肤（core 的 style.css 经适配层打成
// dist/index.css），后者是 demo 外壳的 .pg-* 排版。漏掉前者会让页面"看着像坏了"，
// 而构建退出码依然是 0 —— 正是模板踩过的「CSS 只能靠产物字节确认」那个坑。
import '@x-ac/regex-react/style.css';
import './playground.css';

import { App } from './App';

const host = document.getElementById('app');
if (host === null) {
  throw new Error('playground 挂载点 #app 不存在，请检查 index.html');
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>
);
