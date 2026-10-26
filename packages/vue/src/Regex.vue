<script setup lang="ts">
/**
 * Vue 3 适配层占位组件（M2 骨架）。
 *
 * 刻意保持薄：只做 props → core 纯函数 → 模板的搬运。正则语义（编译、匹配、结构图、
 * 文案表）全部在 `@x-ac/regex-core`，适配层一旦出现正则逻辑就说明分层破了。
 *
 * M3 在此挂上匹配结果与高亮层，M4 挂 `x-ac-regex-diagram` 的 SVG / Canvas 双后端。
 */
import { computed } from 'vue';
import { parseFlags, resolveLocale, translate } from '@x-ac/regex-core';
import type { Locale, MessageKey } from '@x-ac/regex-core';
import '@x-ac/regex-core/style.css';

const props = withDefaults(
  defineProps<{
    pattern?: string;
    flags?: string;
    /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
    localeCandidates?: readonly string[];
  }>(),
  {
    pattern: '',
    flags: 'g',
    localeCandidates: () => []
  }
);

const locale = computed<Locale>(() => resolveLocale(props.localeCandidates));
const t = (key: MessageKey): string => translate(locale.value, key);

const parsed = computed(() => parseFlags(props.flags));
const normalizedFlags = computed(() => (parsed.value.ok ? parsed.value.flags : ''));
const issues = computed(() =>
  parsed.value.issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    text: issue.message
  }))
);
</script>

<template>
  <div class="x-ac-regex-root">
    <h2 class="x-ac-regex-title">{{ t('app.title') }}</h2>
    <p class="x-ac-regex-tagline">{{ t('app.tagline') }}</p>

    <label class="x-ac-regex-field">
      <span>{{ t('field.pattern') }}</span>
      <code class="x-ac-regex-mono x-ac-regex-pattern">/{{ pattern }}/{{ normalizedFlags }}</code>
    </label>

    <label class="x-ac-regex-field">
      <span>{{ t('field.flags') }}</span>
      <code class="x-ac-regex-mono">{{ flags }}</code>
    </label>

    <ul v-if="issues.length" class="x-ac-regex-issues">
      <li
        v-for="issue in issues"
        :key="`${issue.code}-${issue.text}`"
        class="x-ac-regex-issue"
        :class="`x-ac-regex-issue--${issue.severity}`"
      >
        <span class="x-ac-regex-issue__code">{{ issue.code }}</span>
        <span>{{ issue.text }}</span>
      </li>
    </ul>

    <div class="x-ac-regex-diagram">
      <p class="x-ac-regex-diagram__empty">{{ t('view.emptyDiagram') }}</p>
    </div>
  </div>
</template>
