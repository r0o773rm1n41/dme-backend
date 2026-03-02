// modules/quiz/quiz.lifecycle.js
import Quiz from "./quiz.model.js";
import ObservabilityService from "../monitoring/observability.service.js";

async function forceLeaveQuizRoom(quizDate) {
  if (!global.io) return;
  const roomName = `quiz-${quizDate}`;
  const socks = await global.io.in(roomName).fetchSockets();
  for (const s of socks) {
    s.leave(roomName);
  }
}

export const QUIZ_STATES = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LOCKED: "LOCKED",
  PAYMENT_CLOSED: "PAYMENT_CLOSED",
  LIVE: "LIVE",
  ENDED: "ENDED",
  FINALIZED: "FINALIZED",
  RESULT_PUBLISHED: "RESULT_PUBLISHED"
};

export const QUIZ_TRANSITIONS = {
  [QUIZ_STATES.DRAFT]: [QUIZ_STATES.SCHEDULED, QUIZ_STATES.LOCKED],
  [QUIZ_STATES.SCHEDULED]: [QUIZ_STATES.LOCKED, QUIZ_STATES.LIVE],
  [QUIZ_STATES.LOCKED]: [QUIZ_STATES.LIVE, QUIZ_STATES.PAYMENT_CLOSED],
  [QUIZ_STATES.PAYMENT_CLOSED]: [QUIZ_STATES.LIVE],
  [QUIZ_STATES.LIVE]: [QUIZ_STATES.ENDED],
  [QUIZ_STATES.ENDED]: [QUIZ_STATES.FINALIZED, QUIZ_STATES.RESULT_PUBLISHED],
  [QUIZ_STATES.FINALIZED]: [QUIZ_STATES.RESULT_PUBLISHED]
};

export async function canTransition(quizDate, fromState, toState) {
  // If fromState is provided, use it; otherwise get current state from DB
  if (!fromState) {
    const quiz = await Quiz.findOne({ quizDate });
    if (!quiz) return false;
    fromState = quiz.state;
  }

  // Check if the transition is allowed in the rules
  return QUIZ_TRANSITIONS[fromState]?.includes(toState);
}

export async function transitionQuiz(quizDate, toState, adminId = null) {
  const quiz = await Quiz.findOne({ quizDate });
  if (!quiz) throw new Error("Quiz not found");

  const fromState = quiz.state;
  
  // A3: Atomic state transition - validate before changing
  const allowedTransitions = QUIZ_TRANSITIONS[quiz.state] || [];
  if (!allowedTransitions.includes(toState)) {
    throw new Error(`Invalid transition from ${quiz.state} to ${toState}`);
  }

  // A3: Atomic update - set state and timestamp in one operation
  quiz.state = toState;

  const timestampFields = {
    [QUIZ_STATES.LOCKED]: 'lockedAt',
    [QUIZ_STATES.PAYMENT_CLOSED]: 'paymentClosedAt',
    [QUIZ_STATES.LIVE]: 'liveAt',
    [QUIZ_STATES.ENDED]: 'endedAt',
    [QUIZ_STATES.FINALIZED]: 'finalizedAt',
    [QUIZ_STATES.RESULT_PUBLISHED]: 'resultPublishedAt'
  };

  const timestampField = timestampFields[toState];
  if (timestampField) {
    quiz[timestampField] = new Date();
  }

  await quiz.save();

  // G1: Log every quiz state change - who, when, from->to
  const { logAdminAction } = await import('../admin/adminAudit.service.js');
  await logAdminAction(adminId, 'QUIZ_STATE_CHANGE', 'QUIZ', quizDate, {
    fromState,
    toState,
    timestampField,
    transitionedAt: quiz[timestampField],
    triggeredBy: adminId ? 'ADMIN' : 'SYSTEM'
  }, null);

  // Record state change for observability
  await ObservabilityService.recordQuizStateChange(quizDate, fromState, toState, {
    timestampField,
    transitionedAt: quiz[timestampField],
    adminId
  });

  if (global.io) {
    global.io.to(`quiz-${quizDate}`).emit('quiz-state-changed', {
      quizDate, fromState, toState, timestamp: new Date().toISOString(), transitionedAt: quiz[timestampField]
    });
    if ([QUIZ_STATES.ENDED, QUIZ_STATES.FINALIZED, QUIZ_STATES.RESULT_PUBLISHED].includes(toState)) {
      global.io.to(`quiz-${quizDate}`).emit('quiz-ended', { quizDate, toState });
      forceLeaveQuizRoom(quizDate);
    }
  }

  return quiz;
}

export async function getQuizState(quizDate) {
  const quiz = await Quiz.findOne({ quizDate });
  return quiz ? quiz.state : null;
}

export async function isQuizLive(quizDate) {
  return await getQuizState(quizDate) === QUIZ_STATES.LIVE;
}

export async function isQuizClosed(quizDate) {
  const state = await getQuizState(quizDate);
  return [QUIZ_STATES.ENDED, QUIZ_STATES.RESULT_PUBLISHED].includes(state);
}

export async function isQuizFinalized(quizDate) {
  return await getQuizState(quizDate) === QUIZ_STATES.RESULT_PUBLISHED;
}