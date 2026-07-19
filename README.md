# MindSpace

> **MindSpace transforms your notes, photos, memories, and knowledge into a living 3D world you can literally walk through.**

---

## The Problem

Today's productivity tools organize our lives into folders, lists, and databases.

But that's **not how humans naturally remember things.**

We remember:

- 📍 Places
- 🤝 Relationships
- 🚶 Walking through spaces
- 🔗 Connections between ideas

For thousands of years, people have used the **Memory Palace (Method of Loci)** to dramatically improve recall by placing information inside imagined physical spaces.

Yet modern note-taking and productivity apps still expect us to search through flat folders and endless documents.

---

## Our Solution

**MindSpace** turns your personal knowledge into a **living, interactive 3D environment**.

Instead of searching for information, you **walk through it**.

Upload your:

- 📸 Photos
- 📝 Notes
- 📅 Calendar
- 💬 Messages
- 📄 Documents

MindSpace uses AI to generate a personalized world whose layout reflects how **you** think and remember.

Every room, object, and pathway becomes a meaningful representation of your knowledge and memories.

[![Demo Video](https://img.shields.io/badge/▶-Watch%20Demo-red?style=for-the-badge)]([https://your-demo-video-link](https://youtu.be/9xrII0xIUzk))
[![Devpost](https://img.shields.io/badge/Devpost-Submission-003E54?style=for-the-badge&logo=devpost&logoColor=white)](https://devpost.com/software/05-kylian-dictator)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

![Gemini API](https://img.shields.io/badge/Built%20with-Gemini%20API-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)
![WorldLabs](https://img.shields.io/badge/World%20Labs-Gaussian%20Splatting-6C5CE7?style=for-the-badge)
![PICO Emulator](https://img.shields.io/badge/PICO-Emulator%200.13.0-1E90FF?style=for-the-badge)
![TRIPO](https://img.shields.io/badge/TRIPO-3D%20GenAI-FF6B6B?style=for-the-badge)
![WebXR](https://img.shields.io/badge/WebXR-Spatial%20Web-000000?style=for-the-badge)
![Grok](https://img.shields.io/badge/Grok-xAI-1DA1F2?style=for-the-badge)

# Ideation

The idea starts with a question: how can we locate information in our minds, build association, and interact with our own thinking process? Eileen Gu (Gu Ailing) was once asked, "Do you think before you speak? You're so articulate about everything, from geopolitics to aerodynamics to your sport, can you take us to your mind?" That's foundational thinking, and we are building this: something here to take you to your mind. 

<p align="center">
  <img src="assets/can-you-take-us-to-your-brain.gif" alt="Can you take us to your brain? -The basis of a mind architecture">
</p>

<p>Sherlock Holmes is also famous for recalling memories through a mind palace, an association method that made him a brilliant investigator and a man of composed mind. Seeing the short gif below, that's how we imagine the 3D space we're creating would be: you're able to pull objects, find slots of memory, and engage with your own thinking process and awareness.</p>

<p align="center">
  <img src="assets/mindpalace-sherlock-ideation.gif" alt="MindPalace Sherlock Ideation Demo" width="1000">
</p>



# Demo walkthrough 
<details>
<summary>Pics/Screenshots of Demo</summary>

<p>Here is a quick look at MindSpace in action. The first picture shows the upload dialogue, where you drop in your photos and notes to start building your world. </p> 
<p align="center">
  <img src="assets/demo-walkthrough4.png" alt="demo-walkthrough">
</p>
<p> The second picture shows the dialogue for adding an object, where a single memory becomes a small item you can place inside a room. </p>
<p align="center">
  <img src="assets/demo-walkthrough5.png" alt="demo-walkthrough">
</p>

<p> </p>The remaining pictures show real examples of what MindSpace generated, the rooms it built and the memories placed inside them, ready to walk through and explore.</p>
<p align="center">
  <img src="assets/demo-walkthrough1.png" alt="demo-walkthrough">
</p>
<p align="center">
  <img src="assets/demo-walkthrough2.png" alt="demo-walkthrough">
</p>
<p align="center">
  <img src="assets/demo-walkthrough3.png" alt="demo-walkthrough">
</p>

</details>

# How it works

Under the hood, MindSpace isn't a chatbot, it's a small pipeline. When you upload photos or notes, an **LLM agent** reads through everything and decides how it should be organized: does this belong in a room that already exists, or is it something new? The same way you'd naturally group a trip, a person, or an event in your head, rather than a folder of files. For every new room, the agent writes a short text description of the space, and **World Labs' Marble** model turns that description into a real, walkable 3D environment, a **Gaussian splat**, which is essentially a cloud of millions of colored points instead of a traditional 3D mesh, so it can look photorealistic without anyone modeling it by hand. Your actual memories then become small 3D objects placed inside that room at eye level, so you can walk up to one and click it to read what it means. Everything renders in the browser over **WebXR**, so the same world works on a laptop with a mouse or in a VR headset, no extra software needed.

# Tech Stack

`#WorldLabs` `#GaussianSplatting` `#PICOEmulator` `#WebXR` `#Obsidian` `#JSON` `#TextTo3D` `#SpatialComputing` `#XR` `#VR` `#JavaScript` `#Python` `#PromptEngineering` `#API` `#Gemini` `#SpatialAudio` `#3DGeneration`

# Setup / run instructions

### Environment Variables

Root `.env`:
```env
WORLDLABS_API_KEY=
GROQ_API_KEY=
TRIPO_API_KEY=
GEMINI_API_KEY=
```

`server/.env`:
```env
TRIPO_API_KEY=
```

### Install

```bash
cd server && npm install && cd ..
cd pipeline && npm install && cd ..
```

### Run

Two terminals, side by side:

```bash
# Terminal 1 — frontend (proxies /api -> :8090)
npm run dev              # https://localhost:8081
```

```bash
# Terminal 2 — backend (spawns the pipeline)
cd server && npm run dev # http://localhost:8090
```
# Team + links 
[![Demo Video](https://img.shields.io/badge/▶-Watch%20Demo-red?style=for-the-badge)](https://your-demo-video-link)
[![Devpost](https://img.shields.io/badge/Devpost-Submission-003E54?style=for-the-badge&logo=devpost&logoColor=white)](https://devpost.com/software/05-kylian-dictator)
