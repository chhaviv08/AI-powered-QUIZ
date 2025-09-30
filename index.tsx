/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from '@google/genai';

// --- CONFIGURATION ---
const QUIZ_LENGTH = 10;
const TIME_PER_QUESTION = 60; // in seconds
const TRANSITION_DURATION = 400; // in milliseconds, must match CSS

// --- DOM ELEMENTS ---
const app = document.getElementById('app') as HTMLDivElement;
const body = document.body;

// --- STATE ---
let questions: any[] = [];
let resources: any[] = [];
let groundingMetadata: any[] = [];
let userAnswers: (string | null)[] = [];
let currentQuestionIndex = 0;
let score = 0;
let timer = 0;
let timerInterval: number | null = null;
let isLoading = false;
let selectedDifficulty = 'Easy'; // Default difficulty
let currentTheme = 'light';

// --- GEMINI API ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function fetchQuizQuestions(topic: string, difficulty: string) {
  if (!topic) return null;
  
  try {
    const prompt = `You are a quiz generation API. Your task is to generate a JSON object based on the topic "${topic}" and difficulty "${difficulty}".
    Respond with nothing but a single, valid JSON object. Do not include any introductory text, markdown formatting, or explanations outside of the JSON.
    The JSON object must have two top-level keys:
    1. "questions": An array of ${QUIZ_LENGTH} ${difficulty}-level multiple-choice questions about the topic using up-to-date information from the web. Each question object must have four keys: "question" (string), "options" (an array of 4 strings), "answer" (a string that exactly matches one of the options), and "explanation" (a brief string explaining why the answer is correct).
    2. "resources": An array of 3-5 free, high-quality online learning resources (articles, videos, courses) relevant to the topic. Each resource object must have three keys: "title" (string), "link" (a valid URL string), and "description" (a brief string explaining the resource).`;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{googleSearch: {}}],
      },
    });

    groundingMetadata = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    let jsonText = response.text;
    
    const startIndex = jsonText.indexOf('{');
    const endIndex = jsonText.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
        throw new Error("Could not find a valid JSON object in the model's response.");
    }

    jsonText = jsonText.substring(startIndex, endIndex + 1);

    const jsonResponse = JSON.parse(jsonText);

    if (!jsonResponse.questions || !Array.isArray(jsonResponse.questions) || jsonResponse.questions.length === 0) {
        throw new Error('Invalid data format from API. Expected a "questions" array.');
    }
    const firstQuestion = jsonResponse.questions[0];
    if (!('question' in firstQuestion && 'options' in firstQuestion && 'answer' in firstQuestion && 'explanation' in firstQuestion && Array.isArray(firstQuestion.options))) {
        throw new Error('Questions in the API response have a missing or invalid key.');
    }
    
    if (!jsonResponse.resources || !Array.isArray(jsonResponse.resources)) {
        console.warn("API response did not contain a valid 'resources' array.");
        jsonResponse.resources = [];
    }

    return jsonResponse;
  } catch (error) {
    console.error("Failed to fetch or parse quiz questions:", error);
    throw new Error(`We couldn't generate a quiz for "${topic}". The AI might be having trouble, or the topic is too specific. Please try a different topic or difficulty.`);
  }
}

// --- THEME ---
function applyTheme(theme: 'light' | 'dark') {
    currentTheme = theme;
    if (theme === 'dark') {
        body.classList.add('dark-mode');
    } else {
        body.classList.remove('dark-mode');
    }
    const toggle = document.getElementById('theme-toggle') as HTMLInputElement;
    if (toggle) {
        toggle.checked = theme === 'dark';
    }
}

function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}

function setupThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    toggle?.addEventListener('change', toggleTheme);
}

// --- RENDERING & TRANSITIONS ---
function transitionTo(renderFunc: () => void) {
  app.classList.add('fade-out');

  setTimeout(() => {
    renderFunc();
    app.classList.remove('fade-out');
  }, TRANSITION_DURATION);
}

function getThemeToggleHtml() {
    return `
        <label class="theme-switch" for="theme-toggle" aria-label="Toggle dark mode">
            <input type="checkbox" id="theme-toggle" ${currentTheme === 'dark' ? 'checked' : ''}>
            <span class="slider"></span>
        </label>
    `;
}

function renderLoading() {
  app.innerHTML = `
    <h1>Generating Quiz...</h1>
    <div class="loader"></div>
    <p>Please wait while our AI searches the web to create your custom quiz!</p>
  `;
}

function renderStartScreen() {
  app.innerHTML = `
    ${getThemeToggleHtml()}
    <h1>AI-Powered Quiz</h1>
    <p>Enter a topic and select a difficulty to start your personalized quiz.</p>
    <h2 id="difficulty-label" class="difficulty-label">Select Difficulty</h2>
    <div class="difficulty-selector" role="radiogroup" aria-labelledby="difficulty-label">
        <button class="difficulty-btn" data-difficulty="Easy" role="radio" aria-checked="true">Easy</button>
        <button class="difficulty-btn" data-difficulty="Medium" role="radio" aria-checked="false">Medium</button>
        <button class="difficulty-btn" data-difficulty="Hard" role="radio" aria-checked="false">Hard</button>
    </div>
    <label for="topic-input" class="sr-only">Quiz Topic</label>
    <input type="text" id="topic-input" class="topic-input" placeholder="e.g., Recent Space Discoveries">
    <button id="start-btn" class="btn">Start Quiz</button>
  `;
  setupThemeToggle();

  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const topicInput = document.getElementById('topic-input') as HTMLInputElement;
  const difficultyButtons = document.querySelectorAll('.difficulty-btn');

  difficultyButtons.forEach(btn => {
    if (btn.getAttribute('data-difficulty') === selectedDifficulty) {
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
    }
  });

  difficultyButtons.forEach(button => {
    button.addEventListener('click', () => {
        selectedDifficulty = button.getAttribute('data-difficulty')!;
        difficultyButtons.forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-checked', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-checked', 'true');
    });
  });

  const handleStart = async () => {
    const topic = topicInput.value.trim();
    if (topic && !isLoading) {
      isLoading = true;
      startBtn.disabled = true;
      transitionTo(renderLoading);
      
      try {
        const fetchedData = await fetchQuizQuestions(topic, selectedDifficulty);
        questions = fetchedData.questions;
        resources = fetchedData.resources;
        transitionTo(startQuiz);
      } catch (error) {
        transitionTo(() => renderErrorScreen((error as Error).message));
      }
    }
  };

  startBtn.addEventListener('click', handleStart);
  topicInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      handleStart();
    }
  });
}

function renderQuizScreen() {
  stopTimer();
  const currentQuestion = questions[currentQuestionIndex];
  const isAnswered = userAnswers[currentQuestionIndex] !== null;
  const userAnswer = userAnswers[currentQuestionIndex];
  const progressPercentage = (currentQuestionIndex / questions.length) * 100;

  const optionsHtml = currentQuestion.options
    .map((option: string) => {
        let classes = 'option-btn';
        if (isAnswered) {
            if (option === currentQuestion.answer) classes += ' correct';
            if (option === userAnswer && userAnswer !== currentQuestion.answer) classes += ' incorrect';
        }
        return `<button class="option-btn ${classes}" ${isAnswered ? 'disabled' : ''}>${escapeHtml(option)}</button>`;
    }).join('');

  app.innerHTML = `
    ${getThemeToggleHtml()}
    <div class="progress-bar-container" aria-label="Quiz Progress: ${currentQuestionIndex} of ${questions.length} questions completed">
        <div class="progress-bar-fill" style="width: ${progressPercentage}%"></div>
    </div>
    <div class="quiz-header">
      <p class="progress-text" aria-live="polite">Question ${currentQuestionIndex + 1} / ${questions.length}</p>
      <p class="timer" id="timer-text" aria-live="polite">${isAnswered ? 'Answered' : TIME_PER_QUESTION}</p>
    </div>
    <div class="timer-bar-container">
        <div class="timer-bar" id="timer-bar" style="${isAnswered ? 'animation: none; width: 0;' : ''}"></div>
    </div>
    <h2 role="heading" aria-level="2">${currentQuestionIndex + 1}. ${escapeHtml(currentQuestion.question)}</h2>
    <div class="options-grid">
      ${optionsHtml}
    </div>
    <div class="explanation-container ${isAnswered ? 'visible' : ''}" id="explanation-container" aria-live="polite">
        ${isAnswered ? `<p>${escapeHtml(currentQuestion.explanation)}</p>` : ''}
    </div>
    <div class="quiz-nav">
        <button id="prev-btn" class="nav-btn" ${currentQuestionIndex === 0 ? 'disabled' : ''}>Previous</button>
        <button id="next-btn" class="nav-btn" ${!isAnswered ? 'disabled' : ''}>${currentQuestionIndex === questions.length - 1 ? 'Finish' : 'Next'}</button>
    </div>
  `;
  setupThemeToggle();

  document.getElementById('prev-btn')?.addEventListener('click', handlePrevious);
  document.getElementById('next-btn')?.addEventListener('click', handleNext);

  if (!isAnswered) {
      const optionButtons = document.querySelectorAll('.option-btn');
      optionButtons.forEach(button => {
        button.addEventListener('click', () => handleAnswer(button as HTMLButtonElement));
      });
      startTimer();
  }
}

function handleNext() {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        transitionTo(renderQuizScreen);
    } else {
        calculateScore();
        transitionTo(renderEndScreen);
    }
}

function handlePrevious() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        transitionTo(renderQuizScreen);
    }
}

function calculateScore() {
    score = 0;
    for (let i = 0; i < questions.length; i++) {
        if (userAnswers[i] === questions[i].answer) {
            score++;
        }
    }
}

function animateScore(finalScore: number) {
    const scoreDisplay = document.getElementById('score-display');
    if (!scoreDisplay) return;

    let currentScore = 0;
    const duration = 1200; // ms
    const increment = finalScore === 0 ? 0 : finalScore / (duration / 16); // Avoid division by zero

    const updateScore = () => {
        currentScore += increment;
        if (currentScore >= finalScore) {
            scoreDisplay.textContent = `${finalScore} out of ${questions.length}`;
        } else {
            scoreDisplay.textContent = `${Math.ceil(currentScore)} out of ${questions.length}`;
            requestAnimationFrame(updateScore);
        }
    };
    if (finalScore > 0) {
      requestAnimationFrame(updateScore);
    } else {
      scoreDisplay.textContent = `0 out of ${questions.length}`;
    }
}

function renderEndScreen() {
  const percentage = (score / questions.length) * 100;
  const passed = percentage >= 70;

  const resourcesHtml = resources.length > 0 ? `
    <div class="resources-container" role="region" aria-labelledby="resources-title">
      <h3 id="resources-title" class="resources-title">Free Courses & Resources</h3>
      <ul class="resources-list">
        ${resources.map(resource => `
          <li>
            <a href="${resource.link}" class="resource-link" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(resource.title)}, opens in a new tab">${escapeHtml(resource.title)}</a>
            <p class="resource-description">${escapeHtml(resource.description)}</p>
          </li>
        `).join('')}
      </ul>
    </div>
  ` : '';

  const sourcesHtml = groundingMetadata.length > 0 ? `
    <div class="sources-container" role="region" aria-labelledby="sources-title">
      <h3 id="sources-title" class="sources-title">Sources</h3>
      <ul class="sources-list">
        ${groundingMetadata.map(chunk => `
          <li><a href="${chunk.web.uri}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(chunk.web.title)}, opens in a new tab">${escapeHtml(chunk.web.title)}</a></li>
        `).join('')}
      </ul>
    </div>
  ` : '';

  app.innerHTML = `
    ${getThemeToggleHtml()}
    <h1>Quiz Complete!</h1>
    ${passed 
        ? `<h2 class="final-message pass-message" aria-live="assertive">Congratulations! You Passed!</h2>` 
        : `<h2 class="final-message fail-message" aria-live="assertive">Better Luck Next Time!</h2>`
    }
    <p class="final-score" aria-live="polite">Your final score is <span id="score-display">0 out of ${questions.length}</span> (${percentage.toFixed(0)}%).</p>
    ${resourcesHtml}
    <button id="restart-btn" class="btn">Play Again</button>
    ${sourcesHtml}
  `;
  setupThemeToggle();

  animateScore(score);

  document.getElementById('restart-btn')?.addEventListener('click', () => {
    transitionTo(() => {
        resetState();
        renderStartScreen();
    });
  });
}

function renderErrorScreen(message: string) {
    app.innerHTML = `
        ${getThemeToggleHtml()}
        <h1>Oops! Something Went Wrong</h1>
        <div class="error-message">
            <p>${escapeHtml(message)}</p>
        </div>
        <button id="try-again-btn" class="btn">Try Again</button>
    `;
    setupThemeToggle();
    document.getElementById('try-again-btn')?.addEventListener('click', () => {
        transitionTo(() => {
            resetState();
            renderStartScreen();
        });
    });
}

// --- QUIZ LOGIC ---
function startQuiz() {
  resetState(false);
  questions = shuffleArray(questions);
  userAnswers = new Array(questions.length).fill(null);
  renderQuizScreen();
}

function showExplanation() {
    const explanation = questions[currentQuestionIndex].explanation;
    const explanationContainer = document.getElementById('explanation-container');
    if (explanation && explanationContainer) {
        explanationContainer.innerHTML = `<p>${escapeHtml(explanation)}</p>`;
        explanationContainer.classList.add('visible');
    }
}

function handleAnswer(selectedButton: HTMLButtonElement) {
  stopTimer();
  const selectedAnswer = selectedButton.textContent;
  userAnswers[currentQuestionIndex] = selectedAnswer;

  const correctAnswer = questions[currentQuestionIndex].answer;
  const timerBar = document.getElementById('timer-bar') as HTMLDivElement;
  if (timerBar) timerBar.style.animationPlayState = 'paused';

  const optionButtons = document.querySelectorAll('.option-btn');
  optionButtons.forEach(button => {
    (button as HTMLButtonElement).disabled = true;
    const buttonText = button.textContent;
    if (buttonText === correctAnswer) {
      button.classList.add('correct');
    }
    if (buttonText === selectedAnswer && selectedAnswer !== correctAnswer) {
        button.classList.add('incorrect');
    }
  });

  showExplanation();
  (document.getElementById('next-btn') as HTMLButtonElement).disabled = false;
}

function startTimer() {
  timer = TIME_PER_QUESTION;
  const timerText = document.getElementById('timer-text');
  const timerBar = document.getElementById('timer-bar') as HTMLDivElement;
  
  if (timerText) timerText.textContent = String(timer);
  if (timerBar) {
    timerBar.style.animation = 'none';
    timerBar.offsetHeight;
    timerBar.style.animation = `countdown ${TIME_PER_QUESTION}s linear forwards, pulse 2s ease-in-out infinite`;
  }

  timerInterval = window.setInterval(() => {
    timer--;
    if (timerText) timerText.textContent = String(timer);
    if (timer <= 0) {
      handleTimeUp();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function handleTimeUp() {
  stopTimer();
  userAnswers[currentQuestionIndex] = "timed_out"; // Mark as timed out
  const correctAnswer = questions[currentQuestionIndex].answer;
  const timerBar = document.getElementById('timer-bar') as HTMLDivElement;
  if (timerBar) timerBar.style.animationPlayState = 'paused';

  const optionButtons = document.querySelectorAll('.option-btn');
  optionButtons.forEach(button => {
      (button as HTMLButtonElement).disabled = true;
      if(button.textContent === correctAnswer) {
          button.classList.add('correct');
      }
  });

  showExplanation();
  (document.getElementById('next-btn') as HTMLButtonElement).disabled = false;
}

function resetState(fullReset = true) {
  if (fullReset) {
    questions = [];
    resources = [];
    groundingMetadata = [];
    selectedDifficulty = 'Easy';
  }
  userAnswers = [];
  currentQuestionIndex = 0;
  score = 0;
  isLoading = false;
  stopTimer();
}

// --- UTILITIES ---
function escapeHtml(unsafe: string): string {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- INITIALIZATION ---
function main() {
  const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
  if (savedTheme) {
    applyTheme(savedTheme);
  }
  renderStartScreen();
}

main();