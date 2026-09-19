(() => {
  'use strict';

  const body = document.body;
  const menuToggle = document.querySelector('#menu-toggle');
  const siteNav = document.querySelector('#site-nav');
  const navScrim = document.querySelector('#nav-scrim');
  const desktopQuery = window.matchMedia('(min-width: 960px)');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
  let menuIsOpen = false;

  function setMenuOpen(open, restoreFocus = false) {
    menuIsOpen = Boolean(open && !desktopQuery.matches);
    body.classList.toggle('menu-open', menuIsOpen);
    menuToggle?.setAttribute('aria-expanded', String(menuIsOpen));
    menuToggle?.setAttribute('aria-label', menuIsOpen ? 'Close menu' : 'Open menu');

    if (siteNav) {
      siteNav.inert = !desktopQuery.matches && !menuIsOpen;
      if (desktopQuery.matches) siteNav.removeAttribute('aria-hidden');
      else siteNav.setAttribute('aria-hidden', String(!menuIsOpen));
    }

    if (navScrim) navScrim.hidden = !menuIsOpen;
    if (restoreFocus) menuToggle?.focus({ preventScroll: true });
  }

  if (menuToggle && siteNav) {
    menuToggle.addEventListener('click', () => setMenuOpen(!menuIsOpen));
    siteNav.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) setMenuOpen(false);
    });
    navScrim?.addEventListener('click', () => setMenuOpen(false, true));
    document.addEventListener('click', (event) => {
      if (menuIsOpen && event.target instanceof Node && !siteNav.contains(event.target) && !menuToggle.contains(event.target)) {
        setMenuOpen(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!menuIsOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false, true);
      }
      if (event.key === 'Tab') {
        const controls = [menuToggle, ...siteNav.querySelectorAll(focusableSelector)]
          .filter((element) => element.getClientRects().length > 0);
        const currentIndex = controls.indexOf(document.activeElement);
        const nextIndex = (currentIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[nextIndex]?.focus();
      }
    });

    desktopQuery.addEventListener('change', () => setMenuOpen(false));
    setMenuOpen(false);
  }

  const quoteDialog = document.querySelector('#quote-dialog');
  const serviceDialog = document.querySelector('#service-dialog');
  const reviewDialog = document.querySelector('#review-dialog');
  const dialogs = [quoteDialog, serviceDialog, reviewDialog].filter(Boolean);
  const returnFocus = new WeakMap();
  const backdropPointerDown = new WeakMap();

  function outsideDialog(event, dialog) {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }

  function openDialog(dialog, trigger) {
    if (!dialog) return;
    setMenuOpen(false);
    dialogs.forEach((other) => {
      if (other !== dialog && other.open) other.close();
    });
    returnFocus.set(dialog, trigger || document.activeElement);
    if (!dialog.open) dialog.showModal();
    body.classList.add('dialog-open');
  }

  dialogs.forEach((dialog) => {
    dialog.addEventListener('pointerdown', (event) => {
      backdropPointerDown.set(dialog, event.target === dialog && outsideDialog(event, dialog));
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && backdropPointerDown.get(dialog) && outsideDialog(event, dialog)) dialog.close();
      backdropPointerDown.set(dialog, false);
    });
    dialog.addEventListener('close', () => {
      const anotherDialogIsOpen = dialogs.some((item) => item.open);
      body.classList.toggle('dialog-open', anotherDialogIsOpen);
      if (!anotherDialogIsOpen) {
        const trigger = returnFocus.get(dialog);
        if (trigger instanceof HTMLElement && trigger.isConnected && trigger.getClientRects().length && !trigger.closest('[inert]')) {
          trigger.focus({ preventScroll: true });
        } else if (trigger instanceof Node && siteNav?.contains(trigger) && !desktopQuery.matches) {
          menuToggle?.focus({ preventScroll: true });
        }
      }
    });
  });

  const services = {
    residential: {
      title: 'Residential cleaning',
      description: 'A thoughtful routine for a home that feels good to come back to. Choose a rhythm that fits your life.',
      items: [
        'Dust accessible surfaces, furniture, and windowsills',
        'Clean kitchen counters, sink, and appliance exteriors',
        'Clean bathroom sinks, toilets, showers, and tubs',
        'Vacuum carpets and rugs, and mop hard floors',
        'Empty household waste bins and finish with a general tidy',
      ],
    },
    commercial: {
      title: 'Commercial cleaning',
      description: 'Dependable care for offices, studios, shops, and shared workspaces, planned around the way your business operates.',
      items: [
        'Clean reception, desks, shared areas, and accessible surfaces',
        'Sanitize agreed high-touch points and washroom fixtures',
        'Care for breakroom counters, sinks, and appliance exteriors',
        'Vacuum carpets and mop accessible hard floors',
        'Build timing, access, and waste handling into a custom scope',
      ],
    },
    move: {
      title: 'Move-in / move-out cleaning',
      description: 'A fresh start for an empty home, whether you are settling in or handing over the keys. Final scope depends on the home and its condition.',
      items: [
        'Detailed kitchen and bathroom cleaning',
        'Wipe the interiors of empty cupboards and drawers',
        'Clean accessible baseboards, doors, and windowsills',
        'Vacuum and mop accessible floors throughout the home',
        'Confirm appliance and interior window needs when planning the scope',
      ],
    },
    airbnb: {
      title: 'Airbnb cleaning',
      description: 'A reliable, guest-ready turnover designed around your property, arrival times, and hosting standards.',
      items: [
        'Clean and present kitchens, bathrooms, surfaces, and floors',
        'Reset bedrooms and make beds with host-provided clean linens',
        'Complete a visual check for obvious damage or left items',
        'Check agreed consumables and flag low supplies',
        'Tailor laundry, restocking, and reporting to your hosting plan',
      ],
    },
    carpet: {
      title: 'Professional carpet care',
      description: 'Targeted care for rooms, stairs, and high-traffic areas, selected for your carpet’s fibre, condition, and needs.',
      items: [
        'Review carpet fibre, condition, and areas of concern',
        'Treat agreed rooms, stairs, or high-traffic areas',
        'Give eligible spots focused pre-treatment where appropriate',
        'Use a method suited to the carpet and agreed scope',
        'Explain expected drying time and aftercare before service',
      ],
    },
    'post-construction': {
      title: 'Post-construction cleaning',
      description: 'Detailed cleaning after building or renovation work, planned around the dust, debris, surfaces, and condition of the space.',
      items: [
        'Remove fine construction dust from accessible surfaces',
        'Wipe doors, trim, baseboards, fixtures, and cabinetry exteriors',
        'Clean kitchens, bathrooms, and newly finished areas',
        'Vacuum and mop accessible floors throughout the space',
        'Confirm debris, adhesive, paint, and specialty-cleaning needs in advance',
      ],
    },
  };

  const quoteForm = document.querySelector('#quote-form');
  const frequencyOptions = document.querySelector('#frequency-options');
  const quoteStatus = document.querySelector('#quote-status');
  const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const frequencyLabels = { weekly: 'Every week', biweekly: 'Every two weeks', monthly: 'Every month', once: 'One-time clean' };
  const squareFootageLabels = {
    'under-1000': 'Under 1,000 sq ft',
    '1000-1499': '1,000–1,499 sq ft',
    '1500-1999': '1,500–1,999 sq ft',
    '2000-2499': '2,000–2,499 sq ft',
    '2500-2999': '2,500–2,999 sq ft',
    '3000-plus': '3,000+ sq ft',
  };

  function readQuote() {
    if (!quoteForm) return null;
    const values = new FormData(quoteForm);
    const selectedService = String(values.get('service') || 'residential');
    const service = Object.hasOwn(services, selectedService) ? selectedService : 'residential';
    const selectedSquareFeet = String(values.get('squareFeet') || '1000-1499');
    const squareFeet = Object.hasOwn(squareFootageLabels, selectedSquareFeet) ? selectedSquareFeet : '1000-1499';
    const bathrooms = Math.max(1, Math.min(4, Number(values.get('bathrooms')) || 1));
    const notes = String(values.get('notes') || '').trim().slice(0, 1200);
    const selectedFrequency = String(values.get('frequency') || 'once');
    const recurringServices = ['residential', 'commercial', 'airbnb'];
    const validFrequency = Object.hasOwn(frequencyLabels, selectedFrequency);
    const frequency = recurringServices.includes(service) && validFrequency ? selectedFrequency : 'once';
    const hourlyRates = { standard: 35, 'post-construction': 40 };
    const rate = service === 'post-construction' ? hourlyRates['post-construction'] : hourlyRates.standard;

    return { service, squareFeet, bathrooms, frequency, rate, notes };
  }

  function updateQuote(clearStatus = true) {
    if (!quoteForm) return null;
    const serviceSelect = quoteForm.elements.namedItem('service');
    const recurring = ['residential', 'commercial', 'airbnb'].includes(serviceSelect?.value);
    if (frequencyOptions) frequencyOptions.disabled = !recurring;
    const bathroomSelect = quoteForm.elements.namedItem('bathrooms');
    if (bathroomSelect instanceof HTMLSelectElement) bathroomSelect.disabled = serviceSelect?.value === 'carpet';
    const quote = readQuote();
    if (!quote) return null;

    const rate = document.querySelector('#estimate-rate');
    const frequency = document.querySelector('#estimate-frequency');
    const note = document.querySelector('#estimate-note');
    if (rate) rate.textContent = currency.format(quote.rate);
    if (frequency) frequency.textContent = `${frequencyLabels[quote.frequency]} · ${services[quote.service].title}`;
    if (note) note.textContent = `Selected space: ${squareFootageLabels[quote.squareFeet]}${quote.service === 'carpet' ? '' : ` · ${quote.bathrooms} bathroom${quote.bathrooms === 1 ? '' : 's'}`}.`;
    if (clearStatus && quoteStatus) quoteStatus.textContent = '';
    return quote;
  }

  function openQuote(trigger, requestedService) {
    if (!quoteForm || !quoteDialog) return;
    const serviceSelect = quoteForm.elements.namedItem('service');
    if (requestedService && Object.hasOwn(services, requestedService) && serviceSelect) serviceSelect.value = requestedService;
    updateQuote();
    const focusTarget = serviceDialog?.open ? returnFocus.get(serviceDialog) : trigger;
    openDialog(quoteDialog, focusTarget);
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) {
      event.preventDefault();
      closeButton.closest('dialog')?.close();
      return;
    }

    const quoteButton = event.target.closest('[data-open-quote]');
    if (quoteButton) {
      event.preventDefault();
      openQuote(quoteButton, quoteButton.dataset.service);
      return;
    }

    const reviewButton = event.target.closest('[data-open-review]');
    if (reviewButton) {
      event.preventDefault();
      openDialog(reviewDialog, reviewButton);
      return;
    }

    const detailButton = event.target.closest('[data-service-details]');
    const service = detailButton?.dataset.serviceDetails;
    if (detailButton && service && Object.hasOwn(services, service) && serviceDialog) {
      event.preventDefault();
      const details = services[service];
      const title = document.querySelector('#service-dialog-title');
      const description = document.querySelector('#service-dialog-description');
      const list = document.querySelector('#service-dialog-list');
      const quoteLink = document.querySelector('#service-dialog-quote');
      if (title) title.textContent = details.title;
      if (description) description.textContent = details.description;
      if (list) {
        list.replaceChildren(...details.items.map((item) => {
          const entry = document.createElement('li');
          entry.textContent = item;
          return entry;
        }));
      }
      if (quoteLink) {
        quoteLink.dataset.service = service;
        quoteLink.textContent = 'Estimate this clean';
      }
      openDialog(serviceDialog, detailButton);
      return;
    }

    if (event.target.closest('[data-reset-quote]') && quoteForm) {
      event.preventDefault();
      quoteForm.reset();
      updateQuote();
    }
  });

  if (quoteForm) {
    quoteForm.addEventListener('change', () => updateQuote());
    quoteForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const quote = updateQuote(false);
      if (!quote) return;

      const date = new Date();
      const formattedDate = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' }).format(date);
      const lines = [
        'CARE & CLEAN HOME INC. — CLEANING RATE SUMMARY',
        'Calgary, Alberta',
        `Prepared: ${formattedDate}`,
        '',
        `Service: ${services[quote.service].title}`,
        `Square feet: ${squareFootageLabels[quote.squareFeet]}`,
        `Bathrooms / washrooms: ${quote.service === 'carpet' ? 'Not applicable' : quote.bathrooms}`,
        `Frequency: ${frequencyLabels[quote.frequency]}`,
        `Additional details: ${quote.notes || 'Not provided'}`,
        '',
        `Hourly rate: ${currency.format(quote.rate)} CAD per hour for one cleaner`,
        'Applicable taxes are not included.',
        '',
        'This is a rate summary, not a confirmed total or appointment.',
        'The final cleaning cost depends on the amount of work, the condition of the space, and the time required.',
        'The scope and anticipated hours must be confirmed before booking.',
        'No booking has been made, and no information has been sent.',
      ];
      const file = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      link.href = url;
      link.download = `care-clean-rate-summary-${localDate}.txt`;
      body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (quoteStatus) quoteStatus.textContent = 'Your rate summary has been downloaded. No booking has been made.';
    });
    updateQuote();
  }

  const reviewForm = document.querySelector('#review-form');
  const reviewMessage = document.querySelector('#review-message');
  const reviewCharacterCount = document.querySelector('#review-character-count');
  const reviewStatus = document.querySelector('#review-status');

  function updateReviewCharacterCount() {
    if (reviewMessage && reviewCharacterCount) reviewCharacterCount.textContent = String(reviewMessage.value.length);
  }

  reviewMessage?.addEventListener('input', updateReviewCharacterCount);
  updateReviewCharacterCount();

  reviewForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;

    const values = new FormData(reviewForm);
    const name = String(values.get('name') || '').trim();
    const email = String(values.get('email') || '').trim();
    const service = String(values.get('service') || '').trim();
    const visitDate = String(values.get('visit-date') || '').trim();
    const rating = String(values.get('rating') || '').trim();
    const review = String(values.get('review') || '').trim();
    const subject = `Client review from ${name}`;
    const message = [
      'CARE & CLEAN HOME INC. — CLIENT REVIEW',
      '',
      `First name: ${name}`,
      `Contact email: ${email}`,
      `Service: ${service}`,
      `Approximate visit date: ${visitDate || 'Not provided'}`,
      `Rating: ${rating}/5`,
      '',
      'Review:',
      review,
      '',
      'Permission confirmed: This is my own experience. Care & Clean may contact me to verify it, and may publish my first name and review after verification.',
    ].join('\n');
    const mailto = `mailto:care.cleanyyc@outlook.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

    if (reviewStatus) reviewStatus.textContent = 'Your email app is opening. Please send the prepared message to submit your review.';
    window.location.href = mailto;
  });

  const heroCarousel = document.querySelector('[data-hero-carousel]');
  const carouselSlides = heroCarousel ? Array.from(heroCarousel.querySelectorAll('[data-carousel-slide]')) : [];
  const carouselDots = heroCarousel ? Array.from(heroCarousel.querySelectorAll('[data-carousel-dot]')) : [];
  let carouselIndex = 0;
  let carouselTimer = 0;
  let swipeStartX = null;

  function showCarouselSlide(nextIndex, userInitiated = false) {
    if (!carouselSlides.length) return;
    carouselIndex = (nextIndex + carouselSlides.length) % carouselSlides.length;
    carouselSlides.forEach((slide, index) => {
      const active = index === carouselIndex;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    carouselDots.forEach((dot, index) => {
      const active = index === carouselIndex;
      dot.classList.toggle('is-active', active);
      if (active) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    if (userInitiated) restartCarousel();
  }

  function stopCarousel() {
    window.clearInterval(carouselTimer);
    carouselTimer = 0;
  }

  function startCarousel() {
    stopCarousel();
    if (!heroCarousel || carouselSlides.length < 2 || motionQuery.matches || document.hidden) return;
    carouselTimer = window.setInterval(() => showCarouselSlide(carouselIndex + 1), 6500);
  }

  function restartCarousel() {
    stopCarousel();
    startCarousel();
  }

  if (heroCarousel && carouselSlides.length > 1) {
    heroCarousel.querySelector('[data-carousel-prev]')?.addEventListener('click', () => showCarouselSlide(carouselIndex - 1, true));
    heroCarousel.querySelector('[data-carousel-next]')?.addEventListener('click', () => showCarouselSlide(carouselIndex + 1, true));
    carouselDots.forEach((dot, index) => dot.addEventListener('click', () => showCarouselSlide(index, true)));

    heroCarousel.addEventListener('mouseenter', stopCarousel);
    heroCarousel.addEventListener('mouseleave', startCarousel);
    heroCarousel.addEventListener('focusin', stopCarousel);
    heroCarousel.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !heroCarousel.contains(event.relatedTarget)) startCarousel();
    });
    heroCarousel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showCarouselSlide(carouselIndex - 1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showCarouselSlide(carouselIndex + 1, true);
      }
    });
    heroCarousel.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || (event.target instanceof Element && event.target.closest('button'))) return;
      swipeStartX = event.clientX;
    });
    heroCarousel.addEventListener('pointerup', (event) => {
      if (swipeStartX === null) return;
      const distance = event.clientX - swipeStartX;
      swipeStartX = null;
      if (Math.abs(distance) >= 45) showCarouselSlide(carouselIndex + (distance < 0 ? 1 : -1), true);
    });
    heroCarousel.addEventListener('pointercancel', () => { swipeStartX = null; });
    document.addEventListener('visibilitychange', () => document.hidden ? stopCarousel() : startCarousel());
    startCarousel();
  }

  document.querySelectorAll('.faq-list details').forEach((detail) => {
    detail.addEventListener('toggle', () => {
      if (!detail.open) return;
      const group = detail.closest('.faq-list');
      group?.querySelectorAll('details[open]').forEach((other) => {
        if (other !== detail) other.open = false;
      });
    });
  });

  const reveals = document.querySelectorAll('.reveal');
  let revealObserver;

  function showAllReveals() {
    revealObserver?.disconnect();
    document.documentElement.classList.remove('reveal-ready');
    reveals.forEach((element) => element.classList.add('is-visible'));
  }

  if ('IntersectionObserver' in window && !motionQuery.matches) {
    try {
      revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
      reveals.forEach((element) => revealObserver.observe(element));
      document.documentElement.classList.add('reveal-ready');
    } catch {
      showAllReveals();
    }
  } else {
    showAllReveals();
  }

  motionQuery.addEventListener('change', (event) => {
    if (event.matches) {
      showAllReveals();
      stopCarousel();
    } else {
      startCarousel();
    }
  });

  document.querySelectorAll('#current-year, [data-current-year]').forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
})();
