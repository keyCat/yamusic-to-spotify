<script setup lang="ts">
const props = defineProps<{
  activeStep: 1 | 2 | 3 | 4
  availableSteps: Array<1 | 2 | 3 | 4>
}>()
const emit = defineEmits<{ navigate: [step: 1 | 2 | 3 | 4] }>()

const steps = [
  { number: 1, title: 'Источник', description: 'Аккаунты и плейлист' },
  { number: 2, title: 'Совпадения', description: 'Проверка треков' },
  { number: 3, title: 'Подтверждение', description: 'Приватный плейлист' },
  { number: 4, title: 'Перенос', description: 'Прогресс и отчет' },
] as const
</script>

<template>
  <nav aria-label="Этапы переноса">
    <ol class="grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] sm:grid-cols-4">
      <li
        v-for="step in steps"
        :key="step.number"
        class="relative border-b border-white/10 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
        :class="step.number === props.activeStep ? 'bg-[#ffcc00]/10' : ''"
        :aria-current="step.number === props.activeStep ? 'step' : undefined"
      >
        <button
          v-if="props.availableSteps.includes(step.number)"
          type="button"
          class="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffcc00]"
          :aria-label="`Перейти к шагу ${step.number}: ${step.title}`"
          @click="emit('navigate', step.number)"
        >
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full border text-sm font-black"
            :class="step.number <= props.activeStep ? 'border-[#ffcc00] bg-[#ffcc00] text-black' : 'border-white/15 text-white/35'"
          >
            {{ step.number < props.activeStep ? '✓' : step.number }}
          </span>
          <span>
            <strong class="block text-sm" :class="step.number > props.activeStep ? 'text-white/40' : 'text-white'">{{ step.title }}</strong>
            <span class="mt-1 block text-xs text-white/40">{{ step.description }}</span>
          </span>
        </button>
        <div v-else class="flex items-start gap-3" aria-disabled="true">
          <span class="grid size-8 shrink-0 place-items-center rounded-full border border-white/15 text-sm font-black text-white/35">
            {{ step.number }}
          </span>
          <span>
            <strong class="block text-sm text-white/40">{{ step.title }}</strong>
            <span class="mt-1 block text-xs text-white/40">{{ step.description }}</span>
          </span>
        </div>
      </li>
    </ol>
  </nav>
</template>
