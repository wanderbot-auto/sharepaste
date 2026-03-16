package dev.sharepaste.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.LockReset
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.sharepaste.android.data.model.AppUiState
import dev.sharepaste.android.data.model.ConnectionState
import dev.sharepaste.android.data.model.InboxItem
import dev.sharepaste.android.data.model.MessageTone
import dev.sharepaste.android.data.model.PayloadKind
import dev.sharepaste.android.ui.theme.SharePasteBackground
import dev.sharepaste.android.ui.theme.SharePasteDivider
import dev.sharepaste.android.ui.theme.SharePasteOffline
import dev.sharepaste.android.ui.theme.SharePastePrimary
import dev.sharepaste.android.ui.theme.SharePasteSuccess
import dev.sharepaste.android.ui.theme.SharePasteSurface
import dev.sharepaste.android.ui.theme.SharePasteTextSecondary
import dev.sharepaste.android.ui.theme.SharePasteWarning

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SharePasteRoute(
    viewModel: SharePasteViewModel,
    onPickImage: () -> Unit,
    onPickFile: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    SharePasteDashboard(
        state = state,
        onServerChanged = viewModel::onServerChanged,
        onDeviceNameChanged = viewModel::onDeviceNameChanged,
        onRecoveryPhraseChanged = viewModel::onRecoveryPhraseChanged,
        onBindCodeChanged = viewModel::onBindCodeChanged,
        onManualTextChanged = viewModel::onManualTextChanged,
        onPolicyAllowTextChanged = viewModel::onPolicyAllowTextChanged,
        onPolicyAllowImageChanged = viewModel::onPolicyAllowImageChanged,
        onPolicyAllowFileChanged = viewModel::onPolicyAllowFileChanged,
        onPolicyMaxFileSizeMbChanged = viewModel::onPolicyMaxFileSizeMbChanged,
        onClearLocalState = viewModel::clearLocalState,
        onInitialize = viewModel::initializeDevice,
        onRecover = viewModel::recoverGroup,
        onRefresh = viewModel::refreshStatus,
        onLoadDevices = viewModel::loadDevices,
        onRenameDevice = viewModel::renameDevice,
        onRemoveDevice = viewModel::removeDevice,
        onLoadPolicy = viewModel::loadPolicy,
        onSavePolicy = viewModel::savePolicy,
        onGenerateBindCode = viewModel::generateBindCode,
        onRequestBind = viewModel::requestBind,
        onConfirmBind = viewModel::confirmBind,
        onStartSync = viewModel::startSync,
        onStopSync = viewModel::stopSync,
        onSendClipboard = viewModel::sendClipboardText,
        onSendManualText = viewModel::sendManualText,
        onOpenInboxItem = viewModel::openInboxItem,
        onDismissMessage = viewModel::clearMessage,
        onPickImage = onPickImage,
        onPickFile = onPickFile
    )
}

@Composable
private fun SharePasteDashboard(
    state: AppUiState,
    onServerChanged: (String) -> Unit,
    onDeviceNameChanged: (String) -> Unit,
    onRecoveryPhraseChanged: (String) -> Unit,
    onBindCodeChanged: (String) -> Unit,
    onManualTextChanged: (String) -> Unit,
    onPolicyAllowTextChanged: (Boolean) -> Unit,
    onPolicyAllowImageChanged: (Boolean) -> Unit,
    onPolicyAllowFileChanged: (Boolean) -> Unit,
    onPolicyMaxFileSizeMbChanged: (Int) -> Unit,
    onClearLocalState: () -> Unit,
    onInitialize: () -> Unit,
    onRecover: () -> Unit,
    onRefresh: () -> Unit,
    onLoadDevices: () -> Unit,
    onRenameDevice: (String, String) -> Unit,
    onRemoveDevice: (String) -> Unit,
    onLoadPolicy: () -> Unit,
    onSavePolicy: () -> Unit,
    onGenerateBindCode: () -> Unit,
    onRequestBind: () -> Unit,
    onConfirmBind: (String, Boolean) -> Unit,
    onStartSync: () -> Unit,
    onStopSync: () -> Unit,
    onSendClipboard: () -> Unit,
    onSendManualText: () -> Unit,
    onOpenInboxItem: (InboxItem) -> Unit,
    onDismissMessage: () -> Unit,
    onPickImage: () -> Unit,
    onPickFile: () -> Unit
) {
    val scroll = rememberScrollState()
    val policyMb = remember(state.policy.maxFileSizeMb) { state.policy.maxFileSizeMb.toString() }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = SharePasteBackground
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scroll)
                .padding(WindowInsets.systemBars.asPaddingValues())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            HeaderCard(state = state, onRefresh = onRefresh)
            StatusCard(state = state)
            QuickActionsCard(
                state = state,
                onStartSync = onStartSync,
                onStopSync = onStopSync,
                onGenerateBindCode = onGenerateBindCode,
                onRecover = onRecover,
                onSendClipboard = onSendClipboard,
                onPickImage = onPickImage,
                onPickFile = onPickFile
            )
            SetupCard(
                state = state,
                onServerChanged = onServerChanged,
                onDeviceNameChanged = onDeviceNameChanged,
                onRecoveryPhraseChanged = onRecoveryPhraseChanged,
                onClearLocalState = onClearLocalState,
                onInitialize = onInitialize,
                onRecover = onRecover
            )
            DevicesCard(
                state = state,
                onLoadDevices = onLoadDevices,
                onRenameDevice = onRenameDevice,
                onRemoveDevice = onRemoveDevice
            )
            PolicyCard(
                state = state,
                policyMb = policyMb,
                onLoadPolicy = onLoadPolicy,
                onSavePolicy = onSavePolicy,
                onPolicyAllowTextChanged = onPolicyAllowTextChanged,
                onPolicyAllowImageChanged = onPolicyAllowImageChanged,
                onPolicyAllowFileChanged = onPolicyAllowFileChanged,
                onPolicyMaxFileSizeMbChanged = { value ->
                    value.toIntOrNull()?.let(onPolicyMaxFileSizeMbChanged)
                }
            )
            PairAndSendCard(
                state = state,
                onBindCodeChanged = onBindCodeChanged,
                onRequestBind = onRequestBind,
                onManualTextChanged = onManualTextChanged,
                onSendManualText = onSendManualText
            )
            PendingRequestCard(state = state, onConfirmBind = onConfirmBind)
            InboxCard(state = state, onOpenInboxItem = onOpenInboxItem)
            state.message?.let { message ->
                MessageCard(
                    title = message.title,
                    body = message.body,
                    tone = message.tone,
                    onDismiss = onDismissMessage
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun HeaderCard(state: AppUiState, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("SharePaste", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                text = if (state.deviceId.isBlank()) "Android dashboard" else state.server,
                style = MaterialTheme.typography.bodyMedium,
                color = SharePasteTextSecondary
            )
        }
        IconButton(onClick = onRefresh) {
            Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
        }
    }
}

@Composable
private fun StatusCard(state: AppUiState) {
    val gradient = when (state.connectionState) {
        ConnectionState.CONNECTED -> listOf(SharePastePrimary, Color(0xFF4B9FFF))
        ConnectionState.CONNECTING -> listOf(Color(0xFFFFA726), Color(0xFFFFD54F))
        ConnectionState.DISCONNECTED -> listOf(SharePasteOffline, SharePasteOffline.copy(alpha = 0.84f))
    }
    val title = when (state.connectionState) {
        ConnectionState.CONNECTED -> "Online"
        ConnectionState.CONNECTING -> "Connecting..."
        ConnectionState.DISCONNECTED -> "Offline"
    }
    val subtitle = when (state.connectionState) {
        ConnectionState.CONNECTED -> "Synced and ready"
        ConnectionState.CONNECTING -> "Timeout in ${state.remainingSeconds}s"
        ConnectionState.DISCONNECTED -> "Sync paused"
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.Transparent),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier
                .background(Brush.linearGradient(gradient))
                .padding(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                )
                Spacer(Modifier.width(8.dp))
                Text(title, color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(6.dp))
            Text(subtitle, color = Color.White.copy(alpha = 0.84f), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                StatusMeta(label = "Server", value = state.server)
                StatusMeta(label = "Device", value = state.deviceName)
                if (state.deviceId.isNotBlank()) {
                    StatusMeta(label = "Group", value = state.groupId.take(10))
                }
            }
        }
    }
}

@Composable
private fun StatusMeta(label: String, value: String) {
    Column {
        Text(value, color = Color.White, fontWeight = FontWeight.SemiBold)
        Text(label, color = Color.White.copy(alpha = 0.68f), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun QuickActionsCard(
    state: AppUiState,
    onStartSync: () -> Unit,
    onStopSync: () -> Unit,
    onGenerateBindCode: () -> Unit,
    onRecover: () -> Unit,
    onSendClipboard: () -> Unit,
    onPickImage: () -> Unit,
    onPickFile: () -> Unit
) {
    DashboardCard {
        Text("Quick Actions", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionChip(
                title = if (state.connectionState == ConnectionState.CONNECTED) "Stop Sync" else "Start Sync",
                icon = if (state.connectionState == ConnectionState.CONNECTED) Icons.Rounded.Stop else Icons.Rounded.PlayArrow,
                accent = if (state.connectionState == ConnectionState.CONNECTED) SharePasteWarning else SharePasteSuccess,
                enabled = state.isBootstrapped && !state.busy,
                onClick = if (state.connectionState == ConnectionState.CONNECTED) onStopSync else onStartSync
            )
            ActionChip("Bind Code", Icons.Rounded.Key, SharePastePrimary, state.isBootstrapped && !state.busy, onGenerateBindCode)
            ActionChip("Recover", Icons.Rounded.LockReset, Color(0xFF8E5AF7), !state.busy, onRecover)
            ActionChip("Send Clipboard", Icons.Rounded.ContentCopy, SharePastePrimary, state.isBootstrapped && !state.busy, onSendClipboard)
            ActionChip("Pick Image", Icons.Rounded.Image, SharePastePrimary, state.isBootstrapped && !state.busy, onPickImage)
            ActionChip("Pick File", Icons.Rounded.Description, SharePastePrimary, state.isBootstrapped && !state.busy, onPickFile)
        }
    }
}

@Composable
private fun SetupCard(
    state: AppUiState,
    onServerChanged: (String) -> Unit,
    onDeviceNameChanged: (String) -> Unit,
    onRecoveryPhraseChanged: (String) -> Unit,
    onClearLocalState: () -> Unit,
    onInitialize: () -> Unit,
    onRecover: () -> Unit
) {
    DashboardCard {
        Text("Settings & Bootstrap", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.server,
            onValueChange = onServerChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Server Address") },
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = state.deviceName,
            onValueChange = onDeviceNameChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Device Name") },
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = state.recoveryPhraseInput,
            onValueChange = onRecoveryPhraseChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Recovery Phrase") },
            minLines = 2
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onInitialize,
                enabled = !state.busy,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Rounded.Save, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Save & Initialize")
            }
            FilledTonalButton(
                onClick = onRecover,
                enabled = !state.busy,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Rounded.Link, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Recover Group")
            }
        }
        if (state.recoveryPhrase.isNotBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Recovery phrase saved locally. Keep it offline and do not leave it visible on-screen.",
                style = MaterialTheme.typography.bodyMedium,
                color = SharePasteTextSecondary
            )
        }
        if (state.isBootstrapped) {
            Spacer(Modifier.height(12.dp))
            FilledTonalButton(
                onClick = onClearLocalState,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.filledTonalButtonColors(
                    containerColor = SharePasteWarning.copy(alpha = 0.12f),
                    contentColor = SharePasteWarning
                )
            ) {
                Icon(Icons.Rounded.Delete, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text("Clear Local State")
            }
        }
    }
}

@Composable
private fun DevicesCard(
    state: AppUiState,
    onLoadDevices: () -> Unit,
    onRenameDevice: (String, String) -> Unit,
    onRemoveDevice: (String) -> Unit
) {
    DashboardCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Connected Devices", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onLoadDevices, enabled = state.isBootstrapped && !state.busy) {
                Icon(Icons.Rounded.Refresh, contentDescription = "Load devices")
            }
        }
        if (state.devices.isEmpty()) {
            Text("No devices loaded", color = SharePasteTextSecondary)
        } else {
            state.devices.forEachIndexed { index, device ->
                var isEditing by remember(device.deviceId) { mutableStateOf(false) }
                var renameValue by remember(device.deviceId, device.name) { mutableStateOf(device.name) }
                if (index > 0) HorizontalDivider(color = SharePasteDivider)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(SharePastePrimary.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Rounded.PowerSettingsNew, contentDescription = null, tint = SharePastePrimary)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(device.name, fontWeight = FontWeight.SemiBold)
                            Text(device.platform, color = SharePasteTextSecondary, style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(
                            onClick = {
                                renameValue = device.name
                                isEditing = !isEditing
                            },
                            enabled = !state.busy
                        ) {
                            Icon(
                                if (isEditing) Icons.Rounded.Close else Icons.Rounded.Edit,
                                contentDescription = if (isEditing) "Cancel rename" else "Rename device",
                                tint = SharePasteTextSecondary
                            )
                        }
                        IconButton(onClick = { onRemoveDevice(device.deviceId) }, enabled = !state.busy) {
                            Icon(Icons.Rounded.Delete, contentDescription = "Remove device", tint = SharePasteTextSecondary)
                        }
                    }

                    if (isEditing) {
                        Spacer(Modifier.height(10.dp))
                        OutlinedTextField(
                            value = renameValue,
                            onValueChange = { renameValue = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Rename Device") },
                            singleLine = true,
                            enabled = !state.busy
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledTonalButton(
                                onClick = {
                                    renameValue = device.name
                                    isEditing = false
                                },
                                enabled = !state.busy,
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Cancel")
                            }
                            Button(
                                onClick = {
                                    onRenameDevice(device.deviceId, renameValue)
                                    isEditing = false
                                },
                                enabled = renameValue.trim().isNotBlank() && renameValue.trim() != device.name && !state.busy,
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Rounded.Save, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Save Name")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PolicyCard(
    state: AppUiState,
    policyMb: String,
    onLoadPolicy: () -> Unit,
    onSavePolicy: () -> Unit,
    onPolicyAllowTextChanged: (Boolean) -> Unit,
    onPolicyAllowImageChanged: (Boolean) -> Unit,
    onPolicyAllowFileChanged: (Boolean) -> Unit,
    onPolicyMaxFileSizeMbChanged: (String) -> Unit
) {
    DashboardCard {
        Text("Policy", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        if (!state.policy.loaded) {
            Button(onClick = onLoadPolicy, enabled = state.isBootstrapped && !state.busy, modifier = Modifier.fillMaxWidth()) {
                Text("Load Policy")
            }
            return@DashboardCard
        }

        PolicySwitchRow("Text", state.policy.allowText, onPolicyAllowTextChanged)
        PolicySwitchRow("Image", state.policy.allowImage, onPolicyAllowImageChanged)
        PolicySwitchRow("File", state.policy.allowFile, onPolicyAllowFileChanged)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = policyMb,
            onValueChange = onPolicyMaxFileSizeMbChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Max File Size (MB)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
        )
        Spacer(Modifier.height(12.dp))
        Button(onClick = onSavePolicy, modifier = Modifier.fillMaxWidth(), enabled = !state.busy) {
            Text("Save Policy")
        }
    }
}

@Composable
private fun PolicySwitchRow(title: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun PairAndSendCard(
    state: AppUiState,
    onBindCodeChanged: (String) -> Unit,
    onRequestBind: () -> Unit,
    onManualTextChanged: (String) -> Unit,
    onSendManualText: () -> Unit
) {
    DashboardCard {
        Text("Pair & Quick Send", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.bindInputCode,
            onValueChange = onBindCodeChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Enter Bind Code") },
            singleLine = true
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onRequestBind,
            enabled = state.isBootstrapped && state.bindInputCode.isNotBlank() && !state.busy,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Request Bind")
        }

        state.bindCode?.let { bindCode ->
            Spacer(Modifier.height(16.dp))
            ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = SharePastePrimary.copy(alpha = 0.06f))) {
                Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(bindCode.code, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = SharePastePrimary)
                    Text("Expires in ${bindCode.secondsRemaining(System.currentTimeMillis() / 1000)}s", color = SharePasteTextSecondary)
                }
            }
        }

        if (state.pendingBindRequestId.isNotBlank()) {
            Spacer(Modifier.height(12.dp))
            Text("Pending bind request: ${state.pendingBindRequestId}", color = SharePasteTextSecondary)
        }

        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = state.manualTextInput,
            onValueChange = onManualTextChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Manual Text Payload") },
            minLines = 3
        )
        Spacer(Modifier.height(8.dp))
        FilledTonalButton(
            onClick = onSendManualText,
            enabled = state.isBootstrapped && state.manualTextInput.isNotBlank() && !state.busy,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Rounded.Send, contentDescription = null)
            Spacer(Modifier.width(6.dp))
            Text("Send Text")
        }
    }
}

@Composable
private fun PendingRequestCard(state: AppUiState, onConfirmBind: (String, Boolean) -> Unit) {
    val request = state.pendingPairingRequest ?: return
    DashboardCard {
        Text("Pending Pairing Request", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("${request.requesterName.ifBlank { request.requesterDeviceId }} wants to join from ${request.requesterPlatform}.")
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onConfirmBind(request.requestId, true) },
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = SharePasteSuccess)
            ) {
                Text("Approve")
            }
            FilledTonalButton(
                onClick = { onConfirmBind(request.requestId, false) },
                modifier = Modifier.weight(1f)
            ) {
                Text("Reject")
            }
        }
    }
}

@Composable
private fun InboxCard(state: AppUiState, onOpenInboxItem: (InboxItem) -> Unit) {
    DashboardCard {
        Text("Inbox", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (state.inbox.isEmpty()) {
            Text("Incoming items will appear here.", color = SharePasteTextSecondary)
        } else {
            state.inbox.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = SharePasteDivider)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenInboxItem(item) }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = when (item.kind) {
                            PayloadKind.TEXT -> Icons.Rounded.ContentCopy
                            PayloadKind.IMAGE -> Icons.Rounded.Image
                            PayloadKind.FILE -> Icons.Rounded.Description
                        },
                        contentDescription = null,
                        tint = SharePastePrimary
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = when (item.kind) {
                                PayloadKind.TEXT -> item.preview.orEmpty()
                                PayloadKind.IMAGE -> item.filePath?.substringAfterLast("/") ?: "Image"
                                PayloadKind.FILE -> item.filePath?.substringAfterLast("/") ?: "File"
                            },
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "${item.kind.name.lowercase()} • ${item.sourceDeviceId.take(10)}",
                            color = SharePasteTextSecondary,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Icon(Icons.Rounded.ArrowUpward, contentDescription = null, tint = SharePasteTextSecondary)
                }
            }
        }
    }
}

@Composable
private fun MessageCard(title: String, body: String, tone: MessageTone, onDismiss: () -> Unit) {
    val accent = when (tone) {
        MessageTone.SUCCESS -> SharePasteSuccess
        MessageTone.ERROR -> SharePasteWarning
        MessageTone.INFO -> SharePastePrimary
    }
    ElevatedCard(
        colors = CardDefaults.elevatedCardColors(containerColor = SharePasteSurface)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.Top
        ) {
            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = accent)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold)
                Text(body, color = SharePasteTextSecondary)
            }
            IconButton(onClick = onDismiss) {
                Icon(Icons.Rounded.Delete, contentDescription = "Dismiss")
            }
        }
    }
}

@Composable
private fun DashboardCard(content: @Composable Column.() -> Unit) {
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.elevatedCardColors(containerColor = SharePasteSurface),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .wrapContentHeight(),
            content = content
        )
    }
}

@Composable
private fun ActionChip(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accent: Color,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = SharePasteSurface,
            contentColor = SharePasteTextPrimary
        ),
        shape = RoundedCornerShape(16.dp)
    ) {
        Icon(icon, contentDescription = null, tint = accent)
        Spacer(Modifier.width(6.dp))
        Text(title)
    }
}
