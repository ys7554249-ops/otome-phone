# Requirements Document

## Introduction

花枝助手增加两类创作能力：按用户描述起草并创建马甲，以及通过对话讨论应用页面布局和视觉风格。马甲资料和界面方案都经过预览与用户确认后才写入。界面定制只使用应用内置组件和固定设计变量，配置保存在当前设备。

## Glossary

- **马甲**：代表用户身份的本地资料卡，可绑定到应用角色。
- **马甲提案**：花枝根据用户描述生成、尚未写入马甲列表的资料草案。
- **页面方案**：针对一个或多个一级页面的内置组件布局及视觉变量配置。
- **组件注册表**：应用为可定制页面提供的稳定组件标识、默认顺序、可见性和尺寸选项清单。
- **界面提案**：花枝根据对话生成、尚未应用的页面方案变更。
- **本机方案**：保存在当前设备应用存储中的页面方案。

## Requirements

### Requirement 1: 对话创建马甲

**User Story:** AS a user, I want 花枝根据我的描述整理完整的马甲资料, SO THAT I can create a role-playing identity through conversation.

#### Acceptance Criteria

1. WHEN the user requests a new persona, THE assistant SHALL collect a name, identity, personality, and secret field in a persona proposal.
2. WHEN the user's description omits a detail required to preserve the requested concept, THE assistant SHALL ask one focused clarification question before presenting the proposal.
3. WHEN enough information exists to draft a persona, THE assistant SHALL display all proposed fields and SHALL preserve the existing persona list until the user confirms creation.
4. WHEN the user confirms a persona proposal, THE assistant SHALL create one persona with a unique identifier and save the persona list.
5. WHEN persona creation succeeds, THE assistant SHALL set the created persona as active and report the result.
6. IF the user cancels a persona proposal, THE assistant SHALL discard the proposal and preserve the persona list and active persona.
7. IF a persona with the proposed name already exists, THE assistant SHALL ask the user to revise the name before creation.
8. WHEN persona creation completes, THE assistant SHALL offer avatar generation as a separate user-initiated action and SHALL preserve the persona if avatar generation is skipped or fails.

### Requirement 2: 对话讨论页面方案

**User Story:** AS a user, I want to discuss page appearance and layout with 花枝, SO THAT I can shape the application without editing source code.

#### Acceptance Criteria

1. THE assistant SHALL support page proposals for the primary application pages: home, assistant, message list, private chat, group chat, moments, contacts, encounter, worldbooks, presets, dates, memories, music, gallery, settings, beauty, personas, map, live, dungeons, fanfic, wallet, couple space, forum, nurture, and snoop.
2. WHEN the user describes a visual or layout goal, THE assistant SHALL map the request to registered page components, component order, visibility, supported size options, built-in component combinations, and approved design variables.
3. THE assistant SHALL preserve each registered page's required navigation, data, and core actions in every proposal.
4. THE assistant SHALL encode proposal content exclusively as validated structured configuration matching the registered schema.
5. IF a requested page or adjustment is absent from the supported registry, THE assistant SHALL identify the unsupported part and keep the current page configuration unchanged.

### Requirement 3: 预览、确认和取消界面提案

**User Story:** AS a user, I want to preview a proposed interface before applying it, SO THAT I can check the result and remain in control of changes.

#### Acceptance Criteria

1. WHEN the assistant prepares a valid interface proposal, THE system SHALL show the affected pages and a preview rendered from registered components and supported design variables.
2. WHEN the user confirms an interface proposal, THE system SHALL apply only the proposal's validated fields to the affected pages and save the resulting configuration on the current device.
3. WHEN the user cancels an interface proposal, THE system SHALL preserve the active page configuration.
4. IF the page configuration changes after a proposal is generated, THE system SHALL identify the conflict and require a refreshed proposal before applying the affected changes.
5. WHEN the user applies a page proposal, THE system SHALL preserve the previous configuration as one-step rollback state.
6. WHEN the user requests rollback, THE system SHALL restore the previous valid local configuration and refresh affected pages.
7. THE system SHALL identify each saved page configuration as local to the current device and display its synchronization status as local-only.

### Requirement 4: Safe customization boundaries

**User Story:** AS a user, I want the assistant's customization controls to stay within supported options, SO THAT an appearance proposal cannot replace application behavior.

#### Acceptance Criteria

1. THE system SHALL accept component identifiers, page identifiers, ordering, visibility, enumerated size options, built-in component variants, and approved design-token values from an interface proposal.
2. THE system SHALL validate every page identifier, component identifier, enum value, value length, and total proposal size before preview or persistence.
3. THE system SHALL render text values as text and SHALL render layout only through application-owned components.
4. IF validation fails, THE system SHALL reject the proposal, report the invalid fields, and preserve the active configuration.
5. WHEN a proposal is sent to the configured model provider, THE assistant SHALL disclose that the user's design description and relevant page/component names are sent for proposal generation.

### Requirement 5: Mobile usability and failure handling

**User Story:** AS a mobile user, I want to create personas and review page proposals on a phone, SO THAT I can complete customization without a desktop.

#### Acceptance Criteria

1. WHEN a proposal is displayed, THE assistant SHALL keep preview, confirm, cancel, and rollback controls usable at viewport widths from 320 CSS pixels.
2. IF the configured model request fails, THE assistant SHALL preserve existing persona and page data and provide a retry action.
3. IF local persistence fails, THE system SHALL report that the change was not saved and SHALL retain the last valid configuration in memory.
4. WHEN no supported change is proposed, THE assistant SHALL explain the available registered options without applying a change.
