<template>
  <header class="px-5 pt-8 pb-6 sm:px-8 sm:pt-10">
    <div class="mx-auto" :class="width">
      <h1 class="display-title">{{ title }}</h1>
      <!-- Two ink rules, a little off register: the home headline's overprint, kept quiet. -->
      <span class="registration" aria-hidden="true" />
      <div v-if="$slots.default" class="mt-4 max-w-[62ch] text-[0.95rem] leading-relaxed text-slate-300">
        <slot />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ title: string; width?: string }>(), { width: 'max-w-2xl' })
</script>

<style scoped>
.registration {
  position: relative;
  display: block;
  width: 2.75rem;
  height: 0.3rem;
  margin-top: 0.9rem;
  border-radius: 9999px;
  background: theme("colors.ember");
}

.registration::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: theme("colors.glow");
  mix-blend-mode: screen;
  transform: translate(0.35rem, 0.18rem);
}
</style>
