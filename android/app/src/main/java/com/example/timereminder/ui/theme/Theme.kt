package com.example.timereminder.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * 清新浅色主题：
 * 浅灰白背景 + 蓝绿主色 + 墨青文字，暖橙仅用于「需要授权 / 已到期」等提示。
 * 低饱和、留白充足，不喧宾夺主。
 */
private val AppColors = lightColorScheme(
    primary = Color(0xFF3A9D8C),          // 青绿
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD6EFE8),
    onPrimaryContainer = Color(0xFF103E36),
    secondary = Color(0xFF5C7A73),        // 灰绿
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDDE8E4),
    onSecondaryContainer = Color(0xFF1E2F2B),
    tertiary = Color(0xFFE9A23B),         // 暖橙（提示/到期）
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFCEED7),
    onTertiaryContainer = Color(0xFF4A3307),
    background = Color(0xFFF6F8F7),       // 暖灰白
    onBackground = Color(0xFF24323D),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF24323D),
    surfaceVariant = Color(0xFFEDF1F0),
    onSurfaceVariant = Color(0xFF5B6665),
    outline = Color(0xFFC9D2D0),
    outlineVariant = Color(0xFFE1E8E6),
    error = Color(0xFFC4453C),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFF8DEDB),
    onErrorContainer = Color(0xFF5C1A16)
)

private val AppTypography = Typography(
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 15.sp)
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp)
)

/** 应用主题：清新浅色风 */
@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AppColors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
