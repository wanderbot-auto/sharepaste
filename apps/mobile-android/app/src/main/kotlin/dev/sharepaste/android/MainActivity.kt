package dev.sharepaste.android

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import dev.sharepaste.android.ui.SharePasteRoute
import dev.sharepaste.android.ui.SharePasteViewModel
import dev.sharepaste.android.ui.theme.SharePasteTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_SERVER = "server"
    }

    private val viewModel by viewModels<SharePasteViewModel>()
    private val clipboardManager by lazy { getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager }
    private val notificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    private val clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
        lifecycleScope.launch {
            viewModel.onForegroundClipboardChanged()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            SharePasteTheme {
                val imagePicker = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.OpenDocument()
                ) { uri ->
                    uri?.let { viewModel.sendUri(it, contentResolver.getType(it)) }
                }
                val filePicker = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.OpenDocument()
                ) { uri ->
                    uri?.let { viewModel.sendUri(it, contentResolver.getType(it)) }
                }

                SharePasteRoute(
                    viewModel = viewModel,
                    onPickImage = { imagePicker.launch(arrayOf("image/*")) },
                    onPickFile = { filePicker.launch(arrayOf("*/*")) }
                )
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        applyIntentOverrides(intent)
    }

    override fun onStart() {
        super.onStart()
        clipboardManager.addPrimaryClipChangedListener(clipboardListener)
    }

    override fun onStop() {
        clipboardManager.removePrimaryClipChangedListener(clipboardListener)
        super.onStop()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyIntentOverrides(intent)
    }

    private fun applyIntentOverrides(intent: android.content.Intent?) {
        val server = intent?.getStringExtra(EXTRA_SERVER)?.trim().orEmpty()
        if (server.isNotBlank()) {
            viewModel.applyLaunchServerOverride(server)
        }
    }
}
