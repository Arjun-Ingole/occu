import { dlopen, FFIType, type Pointer } from "bun:ffi";

const VISUALIZER_NOTIFICATION = "boo.peekaboo.visualizer.event";
const CORE_FOUNDATION =
  "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
const UTF8_ENCODING = 0x08000100;

const coreFoundation = dlopen(CORE_FOUNDATION, {
  CFNotificationCenterGetDistributedCenter: {
    args: [],
    returns: FFIType.ptr
  },
  CFNotificationCenterPostNotification: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.bool],
    returns: FFIType.void
  },
  CFStringCreateWithCString: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.uint32_t],
    returns: FFIType.ptr
  },
  CFRelease: {
    args: [FFIType.ptr],
    returns: FFIType.void
  }
});

export function postVisualizerNotification(descriptor: string): void {
  const { symbols } = coreFoundation;
  const center = symbols.CFNotificationCenterGetDistributedCenter();
  const name = createCFString(VISUALIZER_NOTIFICATION);
  const object = createCFString(descriptor);
  try {
    symbols.CFNotificationCenterPostNotification(
      center,
      name,
      object,
      null,
      true
    );
  } finally {
    symbols.CFRelease(name);
    symbols.CFRelease(object);
  }
}

function createCFString(value: string): Pointer {
  const result = coreFoundation.symbols.CFStringCreateWithCString(
    null,
    Buffer.from(`${value}\0`, "utf8"),
    UTF8_ENCODING
  );
  if (result === null) {
    throw new Error("Could not create a Core Foundation string");
  }
  return result;
}
