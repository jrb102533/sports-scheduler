# First Whistle — Product Requirements Document

## 1. Product Overview

**First Whistle** is a youth sports scheduling and team management platform for coaches, league managers, parents, and players. It handles team rosters, game scheduling, RSVP, attendance tracking, standings, and communication — all from a single app.

### Target Users

| Role | Primary Needs |
|------|---------------|
| **Admin** | Full platform management, user roles, system settings |
| **League Manager** | Create leagues, manage seasons, generate schedules, publish standings |
| **Coach** | Manage roster, schedule events, track attendance, communicate with parents |
| **Parent** | View schedule, RSVP to games, see team info, receive notifications |
| **Player** | View schedule, RSVP, see team info |

### Current Platform

- **Web app**: React 19 + TypeScript + Vite + Tailwind CSS + Zustand
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Storage)
- **Hosting**: Firebase Hosting (`first-whistle-e76f4.web.app`)

---

## 2. Feature Summary

### Core Features (Shipped)

- **Authentication** — Email/password with email verification, role-based access, multi-membership support
- **Team Management** — Create/edit teams, roster management, player status tracking (active/injured/suspended), soft delete/restore
- **Event Scheduling** — Games, practices, tournaments; recurring events; bulk import (CSV/XLSX); conflict detection
- **Schedule Wizard** — Algorithmic schedule generation for leagues with venue constraints, coach availability, and configurable parameters
- **RSVP** — In-app and one-tap email RSVP (Yes/Maybe/No) with HMAC-signed links
- **Snack Volunteers** — Per-game snack slot claiming
- **Attendance Tracking** — Per-event attendance with absent/excused status
- **Standings** — Auto-computed standings with manual rank overrides, tiebreaker configuration
- **Notifications** — In-app + email notifications for events, reminders, cancellations, attendance
- **Messaging** — Coach-to-team messaging
- **Venues** — Venue library with fields, availability windows, geocoding
- **Leagues & Seasons** — League hierarchy, season management, divisions
- **Parent Portal** — Dedicated parent home screen with upcoming games and team info
- **Player Invites** — Email invite flow with auto-link on signup, role propagation
- **Settings** — Kids sports mode, weekly digest toggle

### Planned Features (Backlog)

- Schedule wizard draft resume (#202)
- Incomplete game generation fix (#203)
- Simplify Seasons tab UX (#204)
- TopBar user name/login (#205)
- Logo comparison page
- Playoff bracket builder
- Push notifications (mobile)

---

## 3. Mobile App — Design & Architecture

### 3.1 Approach: React Native with Expo

**Recommendation: React Native + Expo** — maximizes code sharing with the existing React/TypeScript codebase while producing native iOS and Android apps from a single codebase.

#### Why Expo + React Native

| Factor | Expo + React Native | Flutter | PWA |
|--------|-------------------|---------|-----|
| Code reuse with existing app | **High** — same TypeScript, same Firebase SDK, share types/utils | Low — Dart rewrite | **Highest** — same codebase |
| Native feel (gestures, animations) | **Native** | Native | Web-like |
| Push notifications | **Native (APNs + FCM)** | Native | Limited (no iOS Safari) |
| App Store distribution | **Yes** | Yes | No |
| Offline support | Good (AsyncStorage + Firestore offline) | Good | Limited |
| Maintenance burden | **1 codebase, 2 platforms** | 1 codebase, 2 platforms | 1 codebase, limited reach |
| Camera / contacts / calendar | Native APIs | Native APIs | Restricted |
| Development speed | **Fastest** (Expo Go for dev, EAS for builds) | Moderate | Fastest |

**PWA rejected** because: no iOS push notifications, no App Store presence, limited offline, users expect native apps for sports team management.

**Flutter rejected** because: zero code reuse with existing TypeScript/React codebase, different language (Dart), separate Firebase SDK.

### 3.2 Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Monorepo                          │
│                                                      │
│  packages/                                           │
│  ├── shared/          ← Types, utils, constants      │
│  │   ├── types/       (from existing src/types)      │
│  │   ├── lib/         (dateUtils, constants, etc.)   │
│  │   └── firebase/    (shared Firebase config)       │
│  │                                                    │
│  ├── web/             ← Existing Vite web app        │
│  │   ├── src/                                        │
│  │   └── vite.config.ts                              │
│  │                                                    │
│  └── mobile/          ← New Expo React Native app    │
│      ├── app/         (Expo Router file-based routes) │
│      ├── components/  (native UI components)         │
│      ├── store/       (Zustand stores — shared logic) │
│      └── app.json     (Expo config)                  │
│                                                      │
│  functions/           ← Cloud Functions (unchanged)   │
└─────────────────────────────────────────────────────┘
```

### 3.3 Shared Code Strategy

| Layer | Shared | Platform-Specific |
|-------|--------|-------------------|
| **Types** (`shared/types`) | 100% shared | — |
| **Utilities** (`shared/lib`) | 100% shared (dateUtils, constants) | — |
| **Firebase config** (`shared/firebase`) | Auth, Firestore, Functions | Storage (different SDKs) |
| **Zustand stores** | Business logic shared | Subscribe/persistence adapters |
| **UI components** | — | 100% platform-specific (React DOM vs React Native) |
| **Navigation** | — | React Router (web) vs Expo Router (mobile) |
| **Cloud Functions** | 100% shared backend | — |

**Estimated code reuse: ~40-50%** (types, stores, utilities, Firebase logic)

### 3.4 Mobile App Screens

#### Parent/Player Experience (Soft Launch Priority)

| Screen | Description | Priority |
|--------|-------------|----------|
| **Login/Signup** | Email auth with deep link invite acceptance | P0 |
| **Home** | Upcoming games, team card, quick RSVP | P0 |
| **Game Detail** | Event info, RSVP, snack slot, location map | P0 |
| **Schedule** | Calendar view of team events | P0 |
| **Notifications** | Push + in-app notification list | P0 |
| **Profile** | Edit name, manage memberships | P1 |
| **Team Roster** | View teammates (name only for parents) | P1 |

#### Coach Experience

| Screen | Description | Priority |
|--------|-------------|----------|
| **Dashboard** | Stats, upcoming events, next actions | P1 |
| **Roster Management** | Add/edit players, track status | P1 |
| **Event Management** | Create/edit events, record results | P1 |
| **Attendance** | Mark attendance per event | P1 |
| **Messaging** | Send messages to team | P2 |

#### League Manager / Admin

| Screen | Description | Priority |
|--------|-------------|----------|
| **League Overview** | Teams, standings, schedule | P2 |
| **Schedule Wizard** | Better suited for web — link to web app | P2 |
| **User Management** | Role changes, invites | P2 |

### 3.5 Tech Stack

```
Runtime:        Expo SDK 52+ (React Native 0.76+)
Language:       TypeScript (shared with web)
Navigation:     Expo Router (file-based, like Next.js)
State:          Zustand (same as web)
Firebase:       @react-native-firebase/* (native SDKs)
Push:           expo-notifications + FCM/APNs
UI:             NativeWind (Tailwind for React Native)
                                  or Tamagui
Lists:          FlashList (performant lists)
Calendar:       react-native-calendars
Maps:           react-native-maps
Storage:        AsyncStorage (offline cache)
Build:          EAS Build (Expo Application Services)
OTA Updates:    EAS Update (push JS updates without App Store review)
```

### 3.6 Push Notification Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Cloud Func   │────▶│ FCM / APNs       │────▶│ Mobile App  │
│ (triggers)   │     │ (delivery)       │     │ (receives)  │
└──────────────┘     └──────────────────┘     └─────────────┘

Triggers:
 • onEventCreated → "New game scheduled"
 • sendEventReminders → "Game tomorrow"
 • RSVP follow-ups → "Haven't responded yet"
 • onEventCancelled → "Game cancelled"
 • Attendance missing → "Record attendance"
 • Score posted → "Results are in"
```

**Token registration**: On app launch, register FCM token in `users/{uid}/pushTokens/{tokenId}`. Cloud Functions read tokens and send via `admin.messaging()`.

### 3.7 Offline Strategy

| Data | Strategy |
|------|----------|
| Team roster | Firestore offline persistence (built-in) |
| Upcoming events | Firestore offline persistence |
| RSVP responses | Queue locally, sync when online |
| Attendance | Queue locally, sync when online |
| Notifications | Cache in AsyncStorage |

Firestore's built-in offline persistence handles most cases. For writes (RSVP, attendance), queue in AsyncStorage and sync on reconnect.

### 3.8 Build & Distribution

```
Development:    Expo Go app (instant preview on device)
Preview:        EAS Build → internal distribution (TestFlight / Play Internal)
Production:     EAS Build → App Store Connect / Google Play Console
OTA Updates:    EAS Update (JS-only changes skip App Store review)
```

**CI/CD**: GitHub Actions → EAS Build → automatic submission to stores.

### 3.9 Migration Path

**Phase 1 — Foundation (2-3 weeks)**
- Set up monorepo with `packages/shared`, `packages/web`, `packages/mobile`
- Extract types, utils, constants into `packages/shared`
- Scaffold Expo app with auth flow

**Phase 2 — Parent MVP (2-3 weeks)**
- Home screen, game detail, schedule, RSVP
- Push notifications for game reminders
- Deep link invite acceptance

**Phase 3 — Coach Features (3-4 weeks)**
- Dashboard, roster, event management, attendance
- Messaging

**Phase 4 — Polish & Launch (2 weeks)**
- Offline support, performance tuning
- App Store submissions
- OTA update pipeline

### 3.10 Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo tool | Turborepo or npm workspaces | Simple, fast, TypeScript-native |
| Native Firebase vs JS SDK | `@react-native-firebase/*` | Better performance, native push support, offline persistence |
| UI framework | NativeWind | Reuse Tailwind knowledge from web |
| Navigation | Expo Router | File-based like web routing, deep links built-in |
| Complex features (schedule wizard) | Web only, link from mobile | Complex multi-step UI better on large screens |

---

## 4. Data Model Reference

See `src/types/index.ts` for full TypeScript definitions. Key entities:

- **UserProfile** — uid, email, displayName, role, memberships, teamId, playerId
- **Team** — name, sportType, ageGroup, color, coachId, leagueIds
- **Player** — firstName, lastName, teamId, status, jerseyNumber, position, absence
- **ScheduledEvent** — title, type, date, startTime, teamIds, status, rsvps, result, venueId
- **League** — name, sportType, season, managedBy
- **Season** — name, startDate, endDate, gamesPerTeam, status, tiebreakerConfig
- **Venue** — name, address, lat/lng, fields, defaultAvailabilityWindows
- **AppNotification** — type, title, message, relatedEventId, isRead

---

## 5. API / Cloud Functions Reference

| Function | Type | Description |
|----------|------|-------------|
| `createUserByAdmin` | Callable | Admin creates user with temp password |
| `sendEmail` | Callable | Coach sends message to team |
| `sendInvite` | Callable | Send player invite email |
| `onNotificationCreated` | Trigger | Send email for in-app notifications |
| `rsvpEvent` | HTTP | One-tap RSVP from email (HMAC-signed) |
| `sendEventInvite` | Callable | Send RSVP invite emails |
| `onEventCreated` | Trigger | Notify team of new event |
| `sendEventReminders` | Scheduled | 24-hour game reminders |
| `sendRsvpFollowups` | Scheduled | Nudge non-responders |
| `onEventCancelled` | Trigger | Notify team of cancellation |
| `sendPostGameBroadcast` | Callable | Post-game results email |
| `generateSchedule` | Callable | Schedule generation algorithm |
| `geocodeVenueAddress` | Callable | Geocode venue addresses |
| `submitGameResult` | Callable | Coach submits game score |
| `publishSchedule` | Callable | Publish generated schedule |
| `resolveDispute` | Callable | LM resolves score dispute |
| `overrideStandingRank` | Callable | Manual standing override |
| `sendLeagueInvite` | Callable | Invite coach to league |
| `acceptLeagueInvite` | Callable | Accept league invitation |
| `sendGameDayReminders` | Scheduled | Day-before game reminders |
| `sendSnackReminders` | Scheduled | Snack volunteer reminders |
| `checkWeatherAlerts` | Scheduled | Weather alert checks |
| `sendWeeklyDigest` | Scheduled | Weekly summary email |
| `autoCloseCollections` | Scheduled | Close expired availability collections |
