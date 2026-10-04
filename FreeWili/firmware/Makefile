CC ?= gcc
CFLAGS := -std=c11 -Wall -Wextra -Werror -I. -I../shared

CORE := FreeWiliMain.c Accelerometer.c WiFi.c Feedback.c hardware_freewili.c

.PHONY: test clean

test: build/host_test build/device_main
	./build/host_test
	@./build/device_main; code=$$?; if [ $$code -ne 2 ]; then echo "device entry exited $$code, expected 2"; exit 1; fi

build/host_test: host_test.c $(CORE) ../shared/coach_config.h
	mkdir -p build
	$(CC) $(CFLAGS) -o $@ host_test.c $(CORE)

build/device_main: $(CORE) ../shared/coach_config.h
	mkdir -p build
	$(CC) $(CFLAGS) -DCOACH_DEVICE_MAIN -o $@ $(CORE)

clean:
	rm -rf build
