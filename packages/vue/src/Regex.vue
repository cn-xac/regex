<script setup lang="ts">
/**
 * Vue 3 适配层（M3）。
 *
 * 仍然薄：只做「输入控件 ↔ core 纯函数」的搬运，不含任何正则语义与布局算法。
 * - pattern 输入框**不篡改**用户原文，允许写 `/abc/gi`，由 `parsePatternInput` 解析；
 * - flags 用八个勾选控件表达；
 * - 铁路图由 core 的 `parsePattern → layoutRailroad → renderSvg` 产出**字符串**，
 *   这里只负责挂进 DOM。坐标与配色全在 core，Canvas 后端共用同一份几何。
 *
 * 关于 `v-html`：内容全部来自 `renderSvg`，其中每个 label 都过了 `escapeXml`，
 * 不含任何用户可注入的原始标记；这是本项目里唯一使用 v-html 的地方。
 */
import { computed, ref, watch } from 'vue';
import {
  FLAG_ORDER,
  flagMessage,
  hasFlag,
  isFlagSupported,
  layoutRailroad,
  parseFlags,
  parsePattern,
  parsePatternInput,
  renderSvg,
  resolveLocale,
  translate,
  withFlag
} from '@x-ac/regex-core';
import type { Locale, MessageKey, RegexFlag, SvgTheme } from '@x-ac/regex-core';
import '@x-ac/regex-core/style.css';

const props = withDefaults(
  defineProps<{
    pattern?: string;
    flags?: string;
    /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
    localeCandidates?: readonly string[];
    /** 导出的 SVG 配色。宿主想跟随系统时自行传值（core 不读 matchMedia）。 */
    svgTheme?: SvgTheme;
  }>(),
  { pattern: '', flags: 'g', localeCandidates: () => [], svgTheme: 'light' }
);

const emit = defineEmits<{
  (event: 'update:pattern', value: string): void;
  (event: 'update:flags', value: string): void;
}>();

const locale = computed<Locale>(() => resolveLocale(props.localeCandidates));
const t = (key: MessageKey): string => translate(locale.value, key);

const source = ref<string>(props.pattern);
const flagsModel = ref<string>(props.flags);

watch(
  () => props.pattern,
  (value) => {
    source.value = value;
  }
);
watch(
  () => props.flags,
  (value) => {
    flagsModel.value = value;
  }
);

/** 是否按 `/pattern/flags` 字面量书写 —— 决定 flag 控件可否点击。 */
const isLiteral = computed(() => parsePatternInput(source.value, {}).literal);

const parsed = computed(() =>
  parsePatternInput(source.value, {
    flags: flagsModel.value,
    merge: isLiteral.value ? 'literal' : 'current'
  })
);

const issues = computed(() => [...parsed.value.issues, ...parseFlags(parsed.value.flags).issues]);

/** 铁路图 SVG。pattern 非法（或被复验拒绝）时为空串，界面退回占位提示。 */
const diagram = computed<string>(() => {
  const result = parsePattern(parsed.value.pattern, parsed.value.flags);
  if (!result.ok) return '';
  return renderSvg(layoutRailroad(result.ast), { theme: props.svgTheme });
});

function onSourceInput(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (target === null) return;
  source.value = target.value;
  emit('update:pattern', target.value);
}

function toggleFlag(flag: RegexFlag): void {
  if (isLiteral.value) return;
  flagsModel.value = withFlag(flagsModel.value, flag, !hasFlag(flagsModel.value, flag));
  emit('update:flags', flagsModel.value);
}
</script>

<template>
  <div class="x-ac-regex-root">
    <h2 class="x-ac-regex-title">{{ t('app.title') }}</h2>
    <p class="x-ac-regex-tagline">{{ t('app.tagline') }}</p>

    <label class="x-ac-regex-field">
      <span>{{ t('field.pattern') }}</span>
      <input
        class="x-ac-regex-mono x-ac-regex-input"
        type="text"
        :value="source"
        spellcheck="false"
        autocomplete="off"
        @input="onSourceInput"
      />
    </label>

    <p class="x-ac-regex-note">
      {{ t('view.normalized') }}:
      <code class="x-ac-regex-mono">/{{ parsed.pattern }}/{{ parsed.flags }}</code>
    </p>

    <fieldset class="x-ac-regex-flags" :aria-disabled="isLiteral ? 'true' : 'false'">
      <legend>{{ t('field.flags') }}</legend>
      <label
        v-for="flag in FLAG_ORDER"
        :key="flag"
        class="x-ac-regex-flag"
        :class="{ 'is-unsupported': !isFlagSupported(flag) }"
      >
        <input
          type="checkbox"
          :checked="hasFlag(parsed.flags, flag)"
          :disabled="isLiteral || !isFlagSupported(flag)"
          @change="toggleFlag(flag)"
        />
        <code class="x-ac-regex-flag__code">{{ flag }}</code>
        <span class="x-ac-regex-flag__hint">{{ flagMessage(locale, flag) }}</span>
      </label>
    </fieldset>

    <p v-if="isLiteral" class="x-ac-regex-note">{{ t('note.flagsFromLiteral') }}</p>

    <ul v-if="issues.length" class="x-ac-regex-issues">
      <li
        v-for="(issue, idx) in issues"
        :key="`${issue.code}-${idx}`"
        class="x-ac-regex-issue"
        :class="`x-ac-regex-issue--${issue.severity}`"
      >
        <span class="x-ac-regex-issue__code">{{ issue.code }}</span>
        <span>{{ issue.message }}</span>
      </li>
    </ul>

    <div class="x-ac-regex-diagram" data-backend="svg">
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <div v-if="diagram" class="x-ac-regex-diagram__svg-host" v-html="diagram"></div>
      <p v-else class="x-ac-regex-diagram__empty">{{ t('view.emptyDiagram') }}</p>
    </div>
  </div>
</template>
