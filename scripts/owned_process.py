"""Windows identities for the two disposable notebook connector processes."""
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
kernel.GetProcessTimes.restype = wintypes.BOOL
kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
kernel.TerminateProcess.restype = wintypes.BOOL
kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
kernel.WaitForSingleObject.restype = wintypes.DWORD
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
kernel.CreateMutexW.restype = wintypes.HANDLE
kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
kernel.ReleaseMutex.restype = wintypes.BOOL


def creation_time(handle):
    values = [wintypes.FILETIME() for _ in range(4)]
    if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)):
        raise ctypes.WinError(ctypes.get_last_error())
    return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime


def retire(pid, created):
    if pid is None:
        return
    if type(pid) is not int or type(created) is not int or pid <= 0:
        raise RuntimeError('No verified connector process identity is available.')
    handle = kernel.OpenProcess(0x1000 | 0x100000 | 1, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:
            return
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if creation_time(handle) != created or kernel.WaitForSingleObject(handle, 0) == 0:
            return
        if not kernel.TerminateProcess(handle, 0) and kernel.WaitForSingleObject(handle, 0) != 0:
            raise ctypes.WinError(ctypes.get_last_error())
        if kernel.WaitForSingleObject(handle, 10000) != 0:
            raise RuntimeError('The notebook connector did not stop.')
    finally:
        kernel.CloseHandle(handle)


@contextmanager
def lifecycle_lock(root):
    name = 'Local\\JARVIS-notebook-' + hashlib.sha256(str(root).casefold().encode()).hexdigest()
    handle = kernel.CreateMutexW(None, False, name)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    acquired = False
    try:
        acquired = kernel.WaitForSingleObject(handle, 0) in (0, 0x80)
        if not acquired:
            raise RuntimeError('Another notebook setup command is already running.')
        yield
    finally:
        if acquired:
            kernel.ReleaseMutex(handle)
        kernel.CloseHandle(handle)
