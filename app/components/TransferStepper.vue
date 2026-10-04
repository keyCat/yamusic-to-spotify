<script setup lang="ts">
import { buildWizardSteps, type TransferWizardStep } from '../utils/transfer-wizard'

const props = defineProps<{
  activeStep: TransferWizardStep
  availableSteps: TransferWizardStep[]
  isDesktop?: boolean
}>()
const emit = defineEmits<{ navigate: [step: TransferWizardStep] }>()

const steps = computed(() => buildWizardSteps(Boolean(props.isDesktop)))
const activeStepNumber = computed(() => steps.value.find(step => step.id === props.activeStep)?.number ?? 1)
</script>

<template>
  <nav aria-label="Этапы переноса">
    <ol class="grid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]" :class="props.isDesktop ? 'sm:grid-cols-5' : 'sm:grid-cols-4'">
      <li
        v-for="step in steps"
        :key="step.id"
        class="relative border-b border-white/10 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
        :class="step.id === props.activeStep ? 'bg-[#ffcc00]/10' : ''"
        :aria-current="step.id === props.activeStep ? 'step' : undefined"
      >
        <button
          v-if="props.availableSteps.includes(step.id)"
          type="button"
          class="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffcc00]"
          :aria-label="`Перейти к шагу ${step.number}: ${step.title}`"
          @click="emit('navigate', step.id)"
        >
          <span
            class="grid size-8 shrink-0 place-items-center rounded-full border text-sm font-black"
            :class="step.number <= activeStepNumber ? 'border-[#ffcc00] bg-[#ffcc00] text-black' : 'border-white/15 text-white/35'"
          >
            {{ step.number < activeStepNumber ? '✓' : step.number }}
          </span>
          <span>
            <strong class="block text-sm" :class="step.number > activeStepNumber ? 'text-white/40' : 'text-white'">{{ step.title }}</strong>
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
