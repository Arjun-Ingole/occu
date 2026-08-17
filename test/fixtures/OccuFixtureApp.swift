import AppKit

final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}

final class FixtureDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
  private var window: NSWindow!
  private var counter = 0
  private var counterLabel: NSTextField!
  private var inputStatusLabel: NSTextField!
  private var slider: NSSlider!
  private var sliderValueLabel: NSTextField!
  private var scrollStatusLabel: NSTextField!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 620),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Occu MCP Fixture"
    window.center()
    window.contentView = makeContentView()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    self.window = window
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  private func makeContentView() -> NSView {
    let content = NSView()
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 12
    stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
    stack.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(stack)

    let heading = label("Occu MCP Tool Fixture", size: 20, bold: true)
    heading.setAccessibilityIdentifier("occu.heading")
    stack.addArrangedSubview(heading)

    let input = NSTextField(string: "initial-value")
    input.placeholderString = "Automation input"
    input.delegate = self
    input.target = self
    input.action = #selector(inputSubmitted(_:))
    input.setAccessibilityLabel("Automation Input")
    input.setAccessibilityIdentifier("occu.input")
    stack.addArrangedSubview(input)
    input.widthAnchor.constraint(equalToConstant: 420).isActive = true

    inputStatusLabel = label("Input status: initial-value")
    inputStatusLabel.setAccessibilityIdentifier("occu.input-status")
    stack.addArrangedSubview(inputStatusLabel)

    let incrementButton = NSButton(title: "Increment Counter", target: self, action: #selector(incrementCounter(_:)))
    incrementButton.bezelStyle = .rounded
    incrementButton.setAccessibilityIdentifier("occu.increment")
    stack.addArrangedSubview(incrementButton)

    counterLabel = label("Counter: 0")
    counterLabel.setAccessibilityIdentifier("occu.counter")
    stack.addArrangedSubview(counterLabel)

    let checkbox = NSButton(checkboxWithTitle: "Enable Option", target: self, action: #selector(optionChanged(_:)))
    checkbox.setAccessibilityIdentifier("occu.checkbox")
    stack.addArrangedSubview(checkbox)

    slider = NSSlider(value: 25, minValue: 0, maxValue: 100, target: self, action: #selector(sliderChanged(_:)))
    slider.isContinuous = true
    slider.setAccessibilityLabel("Value Slider")
    slider.setAccessibilityIdentifier("occu.slider")
    stack.addArrangedSubview(slider)
    slider.widthAnchor.constraint(equalToConstant: 420).isActive = true

    sliderValueLabel = label("Slider value: 25")
    sliderValueLabel.setAccessibilityIdentifier("occu.slider-value")
    stack.addArrangedSubview(sliderValueLabel)

    scrollStatusLabel = label("Scroll position: 0")
    scrollStatusLabel.setAccessibilityIdentifier("occu.scroll-status")
    stack.addArrangedSubview(scrollStatusLabel)

    let scrollView = makeScrollView()
    stack.addArrangedSubview(scrollView)
    scrollView.widthAnchor.constraint(equalToConstant: 560).isActive = true
    scrollView.heightAnchor.constraint(equalToConstant: 190).isActive = true

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      stack.topAnchor.constraint(equalTo: content.topAnchor),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor),
    ])

    return content
  }

  private func makeScrollView() -> NSScrollView {
    let scrollView = NSScrollView()
    scrollView.hasVerticalScroller = true
    scrollView.borderType = .bezelBorder
    scrollView.setAccessibilityLabel("Fixture Scroll Area")
    scrollView.setAccessibilityIdentifier("occu.scroll-area")

    let document = FlippedView(frame: NSRect(x: 0, y: 0, width: 540, height: 1_500))
    for index in 1...50 {
      let row = label("Scrollable row \(index)")
      row.frame = NSRect(x: 12, y: CGFloat((index - 1) * 29 + 8), width: 480, height: 22)
      row.setAccessibilityIdentifier("occu.row.\(index)")
      document.addSubview(row)
    }
    scrollView.documentView = document
    scrollView.contentView.postsBoundsChangedNotifications = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(scrollPositionChanged(_:)),
      name: NSView.boundsDidChangeNotification,
      object: scrollView.contentView
    )
    return scrollView
  }

  private func label(_ value: String, size: CGFloat = 13, bold: Bool = false) -> NSTextField {
    let field = NSTextField(labelWithString: value)
    field.font = bold ? .boldSystemFont(ofSize: size) : .systemFont(ofSize: size)
    return field
  }

  @objc private func incrementCounter(_ sender: NSButton) {
    counter += 1
    counterLabel.stringValue = "Counter: \(counter)"
  }

  @objc private func optionChanged(_ sender: NSButton) {
    sender.toolTip = sender.state == .on ? "Option enabled" : "Option disabled"
  }

  @objc private func sliderChanged(_ sender: NSSlider) {
    sliderValueLabel.stringValue = "Slider value: \(Int(sender.doubleValue.rounded()))"
  }

  @objc private func inputSubmitted(_ sender: NSTextField) {
    inputStatusLabel.stringValue = "Input status: \(sender.stringValue)"
  }

  func controlTextDidChange(_ notification: Notification) {
    guard let field = notification.object as? NSTextField else { return }
    inputStatusLabel.stringValue = "Input status: \(field.stringValue)"
  }

  @objc private func scrollPositionChanged(_ notification: Notification) {
    guard let clipView = notification.object as? NSClipView else { return }
    scrollStatusLabel.stringValue = "Scroll position: \(Int(clipView.bounds.origin.y.rounded()))"
  }
}

let app = NSApplication.shared
let delegate = FixtureDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
