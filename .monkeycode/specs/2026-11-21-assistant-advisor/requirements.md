# Requirements Document

## Introduction

花枝助手增加两类主动帮助：检查当前设备上的通知配置并发送测试通知；分析用户选择的角色设定及关联内容，给出可选优化建议。角色分析与角色数据修改分离，只有用户确认具体改写后才更新数据。

## Glossary

- **通知自检**：读取当前浏览器、Service Worker、通知权限、主动消息开关和 API 配置的本地可用状态。
- **角色顾问**：针对用户选定角色的性格、关系、口头禅及关联世界书和预设提供分析与建议。
- **改写提案**：角色顾问生成的、尚未应用到角色数据的字段新值。
- **当前用户角色**：绑定当前用户身份、未删除且可由用户选择的角色。

## Requirements

### Requirement 1: 通知状态自检

**User Story:** AS a user, I want 花枝检查通知相关设置, SO THAT I can identify why a desktop notification may not appear.

#### Acceptance Criteria

1. WHEN the user starts notification self-check, THE assistant SHALL display notification API support, permission state, Service Worker registration state, proactive-message toggle state, and whether an API configuration is selected.
2. THE assistant SHALL report API configuration availability without displaying or transmitting API key values as diagnostic output.
3. IF the browser does not support a checked capability, THE assistant SHALL identify that capability and show the relevant limitation.
4. WHEN local diagnostics complete, THE assistant SHALL distinguish browser-observable settings from delivery guarantees that depend on operating-system background behavior.

### Requirement 2: User-initiated notification test

**User Story:** AS a user, I want to send a test notification from the assistant, SO THAT I can verify that this device currently displays notifications.

#### Acceptance Criteria

1. WHEN the user explicitly selects the permission action, THE assistant SHALL request notification permission from that user action.
2. WHEN notification permission is granted and the user selects the test action, THE assistant SHALL display a clearly identified test notification using the active Service Worker when available.
3. IF notification permission is denied or unavailable, THE assistant SHALL explain the next browser or operating-system setting to check.
4. THE assistant SHALL describe the test as a current-device display check and SHALL NOT claim that it verifies delivery after the page or browser is closed.
5. WHEN the assistant page opens, THE system SHALL NOT request notification permission solely because the page opened.

### Requirement 3: Role-persona analysis

**User Story:** AS a user, I want 花枝 to review one of my characters' persona and related materials, SO THAT I can make the character more coherent and easier for the model to portray.

#### Acceptance Criteria

1. WHEN the user starts a persona review, THE assistant SHALL let the user select a current user role.
2. THE assistant SHALL analyze the selected role's personality, relationship, catchphrase, and associated enabled worldbooks and presets.
3. THE assistant SHALL identify strengths and concrete issues such as contradictions, missing behavioral cues, unclear relationship context, and conflicting linked instructions.
4. THE assistant SHALL offer actionable optional edits while preserving the user's stated character concept and distinguish evidence from interpretation.
5. IF the selected role has no associated material in a category, THE assistant SHALL identify that category as absent and SHALL NOT fabricate its content.
6. WHEN a required API configuration is unavailable, THE assistant SHALL explain that model-based role analysis cannot run and preserve the user's existing role data.
7. BEFORE sending selected role materials to the configured model provider, THE assistant SHALL disclose which categories of selected-role data will be included.

### Requirement 4: Confirmed role edits

**User Story:** AS a user, I want to review proposed persona edits before they are applied, SO THAT role data changes only with my approval.

#### Acceptance Criteria

1. WHEN the role adviser produces proposed edits, THE assistant SHALL present the target role, fields, and proposed values without modifying persisted role data.
2. WHEN the user confirms a displayed proposal, THE assistant SHALL apply only the fields and values included in that proposal.
3. IF the stored field value changed after the proposal was created, THE assistant SHALL ask for a new review and SHALL preserve the newer value.
4. WHEN the user cancels or leaves a proposal unconfirmed, THE assistant SHALL preserve all role data.
5. THE system SHALL associate each pending proposal with the selected role identity and its original field values.

### Requirement 5: Mobile usability and clear outcomes

**User Story:** AS a mobile user, I want assistant actions and results to be understandable on a phone, SO THAT I can complete checks and review edits without navigating configuration internals.

#### Acceptance Criteria

1. WHEN the assistant presents diagnostic results or a role proposal, THE assistant SHALL keep action controls usable at mobile viewport widths.
2. THE assistant SHALL present notification results and role-adviser results as separate actions with distinct outcomes.
3. WHEN an operation fails, THE assistant SHALL identify the failed step and give a safe, actionable recovery instruction.
