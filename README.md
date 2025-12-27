[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/tcXJhemk)
# CSE330

# Group Member

* **Name:** Mehak Sharma
* **Student ID:** 530436

---

# Project Overview

**MindMemos** is a peer‑support mental health journaling app. Users can write public journal entries about what they are experiencing (e.g., *panic attacks*), read others’ posts, and learn coping tips from people who have been through similar situations. Topic‑based chat rooms enable real‑time conversations, while search helps users discover related posts and discussions. An upvote/token system highlights posts that have helped others. *(This app is for peer support and is not a substitute for professional care.)*

---

# Tech Stack

* **Frontend:** Angular (TypeScript), Angular Animations, Motion One (motion.dev)
* **Backend:** Node.js with Express
* **Database:** MongoDB
* **Real‑Time Communication:** Socket.IO (for chat rooms)
* **Tooling (TBD as needed):** npm, Git/GitHub, testing & linting utilities

---

# Grading Rubric (100 points)(approved by Cheng)

1. **Rubric Submission (5 points)**

   * **5 points:** Rubric created and uploaded to GitHub on time; verified by TA approval.

2. **Frameworks and Technologies (30 points)**

   * **Frontend Framework — Angular (10 points):** Implement and learn Angular to build an interactive, responsive user interface.
   * **Backend Framework — Express with Node.js (10 points):** Configure Express to handle backend logic and API endpoints for the application.
   * **Database — MongoDB (10 points):** Set up and utilize MongoDB for storing and managing application data.

3. **Functionality (35 points)**

   * **User Authentication (10 points)**

     * **5 points:** Implement user login with proper form validation.
     * **5 points:** Provide a reliable logout flow backed by session management.
   * **Posting (CRUD & Visibility) (10 points)**

     * **10 points:** Users can create, read, edit/update, and delete journal posts; posts are visible to all users.
   * **Chat Room (5 points)**

     * **5 points:** Real‑time, topic/condition‑based rooms where users can communicate and share coping strategies.
   * **Search & Discovery (5 points)**

     * **5 points:** Keyword/tag search to surface similar posts and link users to related content.
   * **Community Impact — Upvotes/Tokens (5 points)**

     * **5 points:** Upvote/acknowledge helpful posts; award non‑monetary tokens that reflect contributor experience/helpfulness.

4. **Creative Portion (20 points)**

   * **20 points:** Reserved for a unique feature or additional improvement added to the project (*TBD*).

5. **Best Practices (5 points)**

   * **Code Quality (5 points):**

     * Code is well‑formatted, follows consistent style guidelines, and is easy to read.
     * HTML output passes a validator with no major issues/errors.

6. **Styling (5 points)**

   * **5 points:** Responsive design across devices, enhanced with **Angular Animations** and **Motion One (motion.dev)** for smooth, accessible UI interactions.

---

# Environment Variables

## Backend (.env)

Required environment variables for the server:

- `OPENAI_API_KEY` - Your OpenAI API key (required for AI chat feature)
- `OPENAI_MODEL` - OpenAI model to use (default: "gpt-4o-mini")
- `OPENAI_BASE_URL` - OpenAI API base URL (default: "https://api.openai.com/v1")
- `EMAIL_PROVIDER` - Email provider: "gmail" or "ethereal" (default: "ethereal")
- `EMAIL_FROM` - Email sender address (e.g., "MindMemos Alerts <mindmemos.alerts@gmail.com>")
- `EMAIL_USER` - Gmail username (required if EMAIL_PROVIDER=gmail)
- `EMAIL_PASS` - Gmail app password (required if EMAIL_PROVIDER=gmail)
- `PORT` - Server port (default: 3000)
- `FRONTEND_URL` - Frontend URL for CORS (default: "http://localhost:4200")
