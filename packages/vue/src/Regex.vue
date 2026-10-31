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
import { computed, ref, watch, type Ref } from 'vue';
import {
  FLAG_ORDER,
  chunkPresentation,
  computeHighlights,
  flagMessage,
  hasFlag,
  isFlagSupported,
  layoutRailroad,
  matchAll,
  parseFlags,
  parsePattern,
  parsePatternInput,
  renderSvg,
  resolveLocale,
  toRenderChunks,
  translate,
  withFlag
} from '@x-ac/regex-core';
import type { Diagram, Locale, MessageKey, RegexFlag, SvgTheme, TranslateParams } from '@x-ac/regex-core';
import { paintDiagramOnCanvas } from './canvas-ctx';
import '@x-ac/regex-core/style.css';

const props = withDefaults(
  defineProps<{
    pattern?: string;
    flags?: string;
    /** 测试文本。 */
    text?: string;
    /** 语言候选（宿主传 `[...navigator.languages]`）；core 不读 navigator，故在此注入。 */
    localeCandidates?: readonly string[];
    /** 导出的 SVG 配色。宿主想跟随系统时自行传值（core 不读 matchMedia）。 */
    svgTheme?: SvgTheme;
    /** 渲染后端：`'svg'`（默认）或 `'canvas'`。 */
    backend?: 'svg' | 'canvas';
  }>(),
  { pattern: '', flags: 'g', text: '', localeCandidates: () => [], svgTheme: 'light', backend: 'svg' }
);

const emit = defineEmits<{
  (event: 'update:pattern', value: string): void;
  (event: 'update:flags', value: string): void;
  (event: 'update:text', value: string): void;
}>();

const locale = computed<Locale>(() => resolveLocale(props.localeCandidates));
const t = (key: MessageKey, params?: TranslateParams): string =>
  translate(locale.value, key, params);

const source = ref<string>(props.pattern);
const flagsModel = ref<string>(props.flags);
const textModel = ref<string>(props.text);

watch(
  () => props.text,
  (value) => {
    textModel.value = value;
  }
);

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

/** 匹配结果 → 区间 → 渲染片段；三者全在 core，视图只负责铺节点。 */
const session = computed(() => matchAll(textModel.value, parsed.value.pattern, parsed.value.flags));
const chunks = computed(() => toRenderChunks(textModel.value, computeHighlights(session.value)));

function onTextInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement | null;
  if (target === null) return;
  textModel.value = target.value;
  emit('update:text', target.value);
}

/** 铁路图几何（Diagram）；pattern 非法时为 null。 */
const diagramData = computed<Diagram | null>(() => {
  const result = parsePattern(parsed.value.pattern, parsed.value.flags);
  if (!result.ok) return null;
  return layoutRailroad(result.ast, { locale: locale.value, flags: parsed.value.flags });
});

/** SVG 字符串（backend='svg' 时用）。 */
const diagramSvg = computed<string>(() => {
  if (diagramData.value === null) return '';
  return renderSvg(diagramData.value, { theme: props.svgTheme });
});

/** Canvas 渲染：backend + diagramData + svgTheme 变化时重绘。 */
const canvasRef: Ref<HTMLCanvasElement | null> = ref(null);
watch(
  [canvasRef, diagramData, () => props.backend, () => props.svgTheme],
  () => {
    if (props.backend !== 'canvas') return;
    const canvas = canvasRef.value;
    if (canvas === null || diagramData.value === null) return;
    paintDiagramOnCanvas(canvas, diagramData.value, props.svgTheme);
  },
  { flush: 'post' }
);

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
  <div class="x-ac-regex-root" :data-theme="props.svgTheme">
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

    <label class="x-ac-regex-field">
      <span>{{ t('field.text') }}</span>
      <textarea
        class="x-ac-regex-mono x-ac-regex-input"
        rows="4"
        :value="textModel"
        spellcheck="false"
        @input="onTextInput"
      />
    </label>

    <p class="x-ac-regex-summary" :data-truncated="session.truncated ? 'true' : 'false'">
      {{ t('view.matchCount', { count: session.matches.length }) }}
      <template v-if="session.truncated">· {{ t('view.truncated') }}</template>
    </p>

    <pre class="x-ac-regex-highlight x-ac-regex-mono"><span
      v-for="chunk in chunks"
      :key="chunk.start"
      :class="chunkPresentation(chunk).classes"
      :data-depth="chunkPresentation(chunk).depth"
      :data-groups="chunkPresentation(chunk).groupOrdinals.join(',') || undefined"
      >{{ chunk.text }}</span></pre>

    <div class="x-ac-regex-diagram" :data-backend="props.backend">
      <template v-if="diagramData">
        <!-- eslint-disable-next-line vue/html-self-closing -->
        <div class="x-ac-regex-diagram__svg-host" v-html="diagramSvg"></div>
        <canvas ref="canvasRef" class="x-ac-regex-diagram__canvas"></canvas>
      </template>
      <p v-else class="x-ac-regex-diagram__empty">{{ t('view.emptyDiagram') }}</p>
    </div>
  </div>
</template>
