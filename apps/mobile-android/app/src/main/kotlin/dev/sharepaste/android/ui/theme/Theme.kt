package dev.sharepaste.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val SharePasteColors = lightColorScheme(
    primary = SharePastePrimary,
    secondary = SharePasteSecondary,
    surface = SharePasteSurface,
    background = SharePasteBackground,
    onPrimary = SharePasteSurface,
    onSurface = SharePasteTextPrimary,
    onBackground = SharePasteTextPrimary
)

@Composable
fun SharePasteTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SharePasteColors,
        content = content
    )
}
