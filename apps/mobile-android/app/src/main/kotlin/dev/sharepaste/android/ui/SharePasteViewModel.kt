package dev.sharepaste.android.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.sharepaste.android.SharePasteApplication
import dev.sharepaste.android.data.model.InboxItem
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class SharePasteViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = (application as SharePasteApplication).repository

    val uiState: StateFlow<dev.sharepaste.android.data.model.AppUiState> = repository.uiState

    init {
        viewModelScope.launch {
            repository.bootstrap()
        }
    }

    fun onServerChanged(value: String) = repository.updateServer(value)

    fun applyLaunchServerOverride(value: String) = repository.applyLaunchServerOverride(value)

    fun onDeviceNameChanged(value: String) = repository.updateDeviceName(value)

    fun onRecoveryPhraseChanged(value: String) = repository.updateRecoveryPhraseInput(value)

    fun onBindCodeChanged(value: String) = repository.updateBindInput(value)

    fun onManualTextChanged(value: String) = repository.updateManualTextInput(value)

    fun onPolicyAllowTextChanged(value: Boolean) = repository.setPolicyAllowText(value)

    fun onPolicyAllowImageChanged(value: Boolean) = repository.setPolicyAllowImage(value)

    fun onPolicyAllowFileChanged(value: Boolean) = repository.setPolicyAllowFile(value)

    fun onPolicyMaxFileSizeMbChanged(value: Int) = repository.setPolicyMaxFileSizeMb(value)

    fun clearMessage() = repository.clearMessage()

    fun clearLocalState() {
        viewModelScope.launch { repository.clearLocalState() }
    }

    fun initializeDevice() {
        viewModelScope.launch { repository.initializeDevice() }
    }

    fun recoverGroup() {
        viewModelScope.launch { repository.recoverGroup() }
    }

    fun loadDevices() {
        viewModelScope.launch { repository.loadDevices() }
    }

    fun renameDevice(targetDeviceId: String, newName: String) {
        viewModelScope.launch { repository.renameDevice(targetDeviceId, newName) }
    }

    fun removeDevice(targetDeviceId: String) {
        viewModelScope.launch { repository.removeDevice(targetDeviceId) }
    }

    fun loadPolicy() {
        viewModelScope.launch { repository.loadPolicy() }
    }

    fun savePolicy() {
        viewModelScope.launch { repository.savePolicy(uiState.value.policy) }
    }

    fun generateBindCode() {
        viewModelScope.launch { repository.generateBindCode() }
    }

    fun requestBind() {
        viewModelScope.launch { repository.requestBind() }
    }

    fun confirmBind(requestId: String, approve: Boolean) {
        viewModelScope.launch { repository.confirmBind(requestId, approve) }
    }

    fun startSync() {
        viewModelScope.launch { repository.startSync() }
    }

    fun stopSync() {
        viewModelScope.launch { repository.stopSync() }
    }

    fun sendClipboardText() {
        viewModelScope.launch { repository.sendClipboardText() }
    }

    fun sendManualText() {
        viewModelScope.launch { repository.sendManualText() }
    }

    fun sendUri(uri: Uri, mime: String?) {
        viewModelScope.launch { repository.sendUri(uri, mime) }
    }

    fun openInboxItem(item: InboxItem) {
        viewModelScope.launch { repository.openInboxItem(item) }
    }

    fun onForegroundClipboardChanged() {
        viewModelScope.launch { repository.onForegroundClipboardChanged() }
    }

    fun refreshStatus() {
        viewModelScope.launch { repository.refreshStatus() }
    }
}
