<script setup lang="ts">
import type {
  MatchingJob,
  ProviderStatus,
  ReviewDecision,
} from '../../shared/transfer-api'
import { useConnections } from '../composables/useConnections'
import { useReviewQueue } from '../composables/useReviewQueue'
import { useSourceSelection } from '../composables/useSourceSelection'
import { useTransferJob } from '../composables/useTransferJob'
import {
  authorizationErrorText,
  contentGridClass,
  navigableSteps,
  pauseReasonText,
  stepForJobState,
} from '../utils/transfer-wizard'

const { data: status } = await useFetch<ProviderStatus>('/api/status')
const route = useRoute()
const matchingMessage = ref('')
const {
  playlistUrl,
  inspectedPublicPlaylistUrl,
  playlist,
  errorMessage,
  pending,
  collectionsResult,
  collectionsPending,
  collectionsMessage,
  selectedCollectionId,
  inspectPlaylist,
  loadYandexCollections,
  inspectPrivateCollection,
  clearCollections,
  clearSourceSelection,
} = useSourceSelection(matchingMessage)
const {
  yandexAuthorization,
  yandexPending,
  yandexMessage,
  yandexTokenInput,
  accountActionPending,
  accountMessage,
  startYandexAuthorization,
  checkYandexAuthorization,
  connectYandexWithToken,
  disconnectSpotify,
  disconnectYandex,
  deleteTransferData,
} = useConnections({
  loadYandexCollections,
  clearCollections,
  clearTransferData: () => {
    resetJob()
    activeStep.value = 1
    clearReviewQueue()
  },
})
const matchingJob = ref<MatchingJob | null>(null)
const activeStep = ref<1 | 2 | 3 | 4>(1)
const {
  matchFilter, reviewDecisions, reviewPage, reviewPageSize, reviewTotal, reviewPageCount,
  reviewPendingEntry, manualSearchEntry, loadReviewDecisions, changeMatchFilter,
  changeReviewPage, changeReviewPageSize, searchManually, saveReviewDecision, clearReviewQueue,
} = useReviewQueue({
  matchingJob, matchingMessage, activeStep,
  onJobChanged: async jobId => readMatchingJob(jobId),
})
const {
  confirmationPending, jobControlPending, readMatchingJob, confirmTransfer,
  restoreMatchingJob, startMatching, startPublicMatching, restartCurrentSearch,
  controlJob, resetJob,
} = useTransferJob({
  matchingJob, matchingMessage, activeStep,
  collectionsResult, selectedCollectionId, inspectedPublicPlaylistUrl,
  onReviewNeeded: loadReviewDecisions, clearReviewQueue,
})
const authorizationError = computed(() => {
  const code = typeof route.query.authError === 'string' ? route.query.authError : ''
  return authorizationErrorText(code)
})
const pauseReasonMessage = computed(() => pauseReasonText(matchingJob.value?.pauseReason || ''))
const quotaResetText = computed(() => {
  if (!matchingJob.value?.nextAttemptAt) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(matchingJob.value.nextAttemptAt))
})
const sourceCoverUrl = computed(() => playlist.value?.coverUrl || reviewDecisions.value[0]?.source.coverUrl || null)
const availableSteps = computed(() => navigableSteps(matchingJob.value?.state || null))
const canStartSearch = computed(() => !matchingJob.value || matchingJob.value.canRestart)
async function navigateToStep(step: 1 | 2 | 3 | 4) {
  if (!availableSteps.value.includes(step)) return
  activeStep.value = step
  if (step === 2 && matchingJob.value && ['review_required', 'ready'].includes(matchingJob.value.state)) {
    await loadReviewDecisions(matchingJob.value.id)
  }
}

function continueCurrentJob() {
  if (!matchingJob.value) return
  void navigateToStep(stepForJobState(matchingJob.value.state))
}

function openMatchStep() {
  if (!matchingJob.value) return
  activeStep.value = 2
  void loadReviewDecisions(matchingJob.value.id)
}

function openConfirmationStep() {
  if (matchingJob.value?.state !== 'ready') return
  activeStep.value = 3
}

function startNewTransfer() {
  resetJob()
  clearReviewQueue()
  clearSourceSelection()
  activeStep.value = 1
}

onMounted(() => {
  if (status.value?.yandex.connections.length) void loadYandexCollections()
  if (status.value?.spotify.connected) void restoreMatchingJob()
})

</script>

<template>
  <main class="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
    <header class="mb-6 flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div class="grid size-11 place-items-center rounded-2xl bg-[#ffcc00] text-lg font-black text-black">↗</div>
        <div>
          <p class="text-sm font-semibold text-white/55">Яндекс Музыка → Spotify</p>
          <h1 class="text-xl font-bold">Музыка без границ</h1>
        </div>
      </div>
      <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60">Шаг {{ activeStep }} из 4</span>
    </header>

    <TransferStepper
      :active-step="activeStep"
      :available-steps="availableSteps"
      @navigate="navigateToStep"
    />

    <section class="mt-8 grid gap-8" :class="contentGridClass(activeStep)">
      <div>
        <p v-if="authorizationError" role="alert" class="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">
          {{ authorizationError }}
        </p>
        <SourceSelectionStep
          v-if="activeStep === 1"
          v-model:playlist-url="playlistUrl"
          :status="status ?? null"
          :matching-job="matchingJob"
          :job-control-pending="jobControlPending"
          :collections-pending="collectionsPending"
          :collections-result="collectionsResult"
          :pending="pending"
          :selected-collection-id="selectedCollectionId"
          :collections-message="collectionsMessage"
          :error-message="errorMessage"
          :playlist="playlist"
          :can-start-search="canStartSearch"
          :inspected-public-playlist-url="inspectedPublicPlaylistUrl"
          @continue="continueCurrentJob"
          @restart="restartCurrentSearch"
          @load-collections="loadYandexCollections"
          @inspect-collection="inspectPrivateCollection"
          @inspect-playlist="inspectPlaylist"
          @start-matching="startMatching"
          @start-public-matching="startPublicMatching"
        />
        <MatchingStep
          v-if="matchingJob && activeStep === 2"
          :matching-job="matchingJob"
          :quota-reset-text="quotaResetText"
          :pause-reason-message="pauseReasonMessage"
          :job-control-pending="jobControlPending"
          @back="navigateToStep(1)"
          @open-confirmation="openConfirmationStep"
          @control="controlJob"
        />
        <ReviewQueue
          v-if="activeStep === 2 && matchingJob && ['review_required', 'ready'].includes(matchingJob.state)"
          v-model:review-page-size="reviewPageSize"
          :matching-job="matchingJob"
          :match-filter="matchFilter"
          :review-decisions="reviewDecisions"
          :review-page="reviewPage"
          :review-total="reviewTotal"
          :review-page-count="reviewPageCount"
          :review-pending-entry="reviewPendingEntry"
          :manual-search-entry="manualSearchEntry"
          @filter-change="changeMatchFilter"
          @page-size-change="changeReviewPageSize"
          @confirm="(entryId, candidateUri) => saveReviewDecision(entryId, { action: 'select', candidateUri })"
          @exclude="entryId => saveReviewDecision(entryId, { action: 'exclude' })"
          @search="searchManually"
          @page-change="changeReviewPage"
        />
        <TransferConfirmationStep
          v-if="matchingJob && activeStep === 3"
          :matching-job="matchingJob"
          :source-cover-url="sourceCoverUrl"
          :confirmation-pending="confirmationPending"
          @back="openMatchStep"
          @confirm="confirmTransfer"
        />
        <TransferProgressStep
          v-if="matchingJob && activeStep === 4"
          :matching-job="matchingJob"
          :pause-reason-message="pauseReasonMessage"
          :job-control-pending="jobControlPending"
          @new-transfer="startNewTransfer"
          @control="controlJob"
        />
        <p v-if="matchingMessage" role="alert" class="mt-3 text-sm font-semibold text-red-300">{{ matchingMessage }}</p>
      </div>

      <ConnectionsPanel
        v-if="activeStep === 1"
        v-model:yandex-token-input="yandexTokenInput"
        :status="status ?? null"
        :yandex-authorization="yandexAuthorization"
        :yandex-pending="yandexPending"
        :yandex-message="yandexMessage"
        :account-action-pending="accountActionPending"
        :account-message="accountMessage"
        @disconnect-spotify="disconnectSpotify"
        @start-yandex-authorization="startYandexAuthorization"
        @disconnect-yandex="disconnectYandex"
        @check-yandex-authorization="checkYandexAuthorization"
        @connect-yandex-with-token="connectYandexWithToken"
        @delete-transfer-data="deleteTransferData"
      />
    </section>
  </main>
</template>
