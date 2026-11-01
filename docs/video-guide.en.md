# FlowLens 1.0 — English walkthrough

[简体中文](video-guide.md) · **English**

[Watch / download the video](https://github.com/hanxiaochi/FlowLens/releases/download/v1.0.0/FlowLens-1.0-guide.en.mp4) · [Subtitles](https://github.com/hanxiaochi/FlowLens/releases/download/v1.0.0/FlowLens-1.0-guide.en.srt)

A real interface recording with English synthetic narration, chapter titles, and subtitles. The application UI shown is Chinese. Built-in example data is fictional. No model API calls are made during this walkthrough. Requests, data writes, and deployment failures are local simulations.

## Chapters

| Time | Chapter |
| --- | --- |
| 00:00 | Start with an idea |
| 00:17 | Describe it, or start from a screenshot |
| 00:39 | Connect a model, or explore offline |
| 00:59 | 1. Submit a leave request |
| 01:20 | 2. Follow the request |
| 01:47 | 3. Switch roles and approve |
| 02:08 | 4. Connect screens, services, and data |
| 02:30 | 5. Refine the prototype |
| 02:49 | 6. Where does the software run? |
| 03:11 | What if the network goes down? |
| 03:31 | Save your design and hand it over |

## Transcript

### Start with an idea

You have an idea for a product. You can sketch the screens, but explaining what happens behind each button is harder. That is what FlowLens is for. In this walkthrough, we will use an employee directory and a leave approval workflow to explore a complete example.

### Describe it, or start from a screenshot

Start by describing what you want in the box on the left. For example: employees submit leave requests, managers approve them, and requests longer than three days need a second approval. You can also upload a prototype screenshot to an image-capable model. Business rules that are missing from the picture still need your review.

### Connect a model, or explore offline

To generate your own design, open the AI connection settings at the top right. Enter your service address, model name, and API key. The key stays in the local server process memory. This walkthrough uses a built-in example, so it makes no model calls and uses no API credits.

### 1. Submit a leave request

Open the leave approval page. Choose an employee, then enter the number of days. We will request five days here. This is an interactive form, not a static mockup: the fields and button are connected to a simulated operation. After submitting, let us follow the process instead of jumping straight to the result.

### 2. Follow the request

The panel on the right follows this operation. A request leaves the device, travels through the network, and reaches the server. The server checks permissions and business rules, then writes to the database. You can play the sequence or step through it. The record only changes at the write step. Finally, the page displays the new request. Both the backend and the data are simulated locally.

### 3. Switch roles and approve

Now switch to the manager role and approve the request. Five days is above the three-day threshold, so the request moves to a second approval instead of being approved immediately. Roles and conditions determine what happens next. When you discuss the design, you can point to the exact rule that needs to change.

### 4. Connect screens, services, and data

Open System Design to see how pages connect to services and stored data. The workflow diagram shows the approval branch we just tested. The entity relationship diagram explains how employees and leave requests are linked. These diagrams share the same model as the interactive pages, so there is no separate specification to keep in sync.

### 5. Refine the prototype

You can keep editing the prototype. In the layout editor, change a section title, its order, or its width. Switch to the phone preview to check the smaller screen. Get the content and interactions clear first, then discuss implementation details with the developers.

### 6. Where does the software run?

Next, open Deployment World. Computers and phones are the entry points. Requests travel through the network to a server, while the database stores the records. Drag to rotate the scene, or select a device to learn what it does. The scene makes deployment easier to discuss, even if you have never built a system before.

### What if the network goes down?

Try the network failure option, then simulate a visit. The request stops where the problem occurs. This helps explain the difference between a network issue, a server failure, and a database problem. It is only a simulation. It does not disconnect your computer from the internet.

### Save your design and hand it over

When the design is ready to discuss, save it or export the project. The developer handoff page also exports an API contract, a database schema, and development notes. These are starting points for implementation, not a production system that is already online. Download version one, explore a built-in example, and work through your idea before you start building.
