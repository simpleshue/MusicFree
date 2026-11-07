package `fun`.upup.musicfree
import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import android.os.Bundle

class MainActivity : ReactActivity() {

  private var isDoubleBackExit: Boolean = false
  private var lastBackActionTime: Long = 0

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "MusicFree"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

  // https://reactnavigation.org/docs/getting-started/#installing-dependencies-into-a-bare-react-native-project
  override fun onCreate(savedInstanceState: Bundle?) {
      SplashScreenManager.registerOnActivity(this)
      super.onCreate(null);
  }

  override fun onBackPressed() {
      val now = System.currentTimeMillis()
      isDoubleBackExit = (now - lastBackActionTime < 2000)
      lastBackActionTime = now

      val delegate = reactActivityDelegate
      if (delegate == null || !delegate.onBackPressed()) {
          invokeDefaultOnBackPressed()
      }
  }

  override fun invokeDefaultOnBackPressed() {
      runOnUiThread {
          if (isDoubleBackExit) {
              super.invokeDefaultOnBackPressed()
          } else {
              val msg = if (java.util.Locale.getDefault().language.startsWith("zh")) "再按一次返回桌面" else "Press again to return to desktop"
              android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
          }
      }
  }
}
