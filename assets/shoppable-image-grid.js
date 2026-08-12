import { Component } from '@theme/component';
import { CartLinesUpdateEvent, StandardEvents } from '@shopify/events';

const selectors = {
  trigger: '[data-shoppable-trigger]',
  template: '[data-shoppable-template]',
  content: '[data-shoppable-content]',
  product: '[data-shoppable-product]',
  variants: '[data-shoppable-variants]',
  optionControl: '[data-shoppable-option]',
  optionGroup: '[data-shoppable-option-group]',
  dropdown: '[data-shoppable-dropdown]',
  selectedText: '[data-shoppable-selected-text]',
  variantInput: '[data-shoppable-variant-id]',
  price: '[data-shoppable-price]',
  image: '[data-shoppable-image]',
  close: '[data-shoppable-close]',
};

const bonusColorValue = 'black';
const bonusSizeValues = ['m', 'medium'];

/** @typedef {{ id: number, available: boolean, options: string[], price: string, image: string | null }} ShoppableVariant */

/**
 * Compact shoppable product grid with one reusable modal.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog
 * @property {HTMLElement} content
 * @property {HTMLButtonElement} closeButton
 *
 * @extends {Component<Refs>}
 */
class ShoppableImageGrid extends Component {
  requiredRefs = ['dialog', 'content', 'closeButton'];

  /** @type {HTMLElement | null} */
  activeTrigger = null;

  /** @type {ShoppableVariant[] | null} */
  variants = null;

  shouldAddBonusProduct = false;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('click', this.handleClick);
    this.addEventListener('change', this.handleChange);
    document.addEventListener(StandardEvents.cartLinesUpdate, this.handleCartUpdate);
    this.refs.dialog.addEventListener('close', this.handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('change', this.handleChange);
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.handleCartUpdate);
    this.refs.dialog.removeEventListener('close', this.handleDialogClose);
  }

  /** @param {MouseEvent} event */
  handleClick = (event) => {
    if (!(event.target instanceof Element)) return;

    const trigger = event.target.closest(selectors.trigger);
    if (trigger instanceof HTMLElement) {
      this.openProduct(trigger);
      return;
    }

    const addButton = event.target.closest('.shoppable-grid__add-button');
    if (addButton instanceof HTMLButtonElement && !addButton.disabled) {
      this.shouldAddBonusProduct = this.selectedOptionsIncludeBonusTrigger();
      this.setAddButtonLoading(addButton, true);
      return;
    }

    if (event.target.closest(selectors.close) || event.target === this.refs.dialog) {
      this.closeDialog();
      return;
    }

    // Clicking an already-checked radio will not emit `change`, so custom dropdowns need a click fallback.
    const optionControl = this.getClickedOptionControl(event.target);
    if (optionControl instanceof HTMLInputElement && optionControl.type === 'radio') {
      const product = optionControl.closest(selectors.product);
      if (!(product instanceof HTMLElement)) return;

      optionControl.checked = true;
      this.updateDropdownLabel(optionControl);
      this.updateProductVariant(product);
    }
  };

  /** @param {Event} event */
  handleChange = (event) => {
    if (!this.isOptionControl(event.target)) return;

    const product = event.target.closest(selectors.product);
    if (!(product instanceof HTMLElement)) return;

    this.updateDropdownLabel(event.target);
    this.updateProductVariant(product);
  };

  /** @param {import('@shopify/events').CartLinesUpdateEvent} event */
  handleCartUpdate = (event) => {
    if (event.detail?.source === 'shoppable-image-grid') return;
    if (!this.refs.content.contains(/** @type {Node | null} */ (event.target))) return;

    event.promise
      ?.then(async ({ detail }) => {
        if (detail?.didError) {
          this.resetAddButtonLoading();
          return;
        }

        if (this.shouldAddBonusProduct) await this.addBonusProduct();

        this.closeDialog();
        // Open after the product modal closes so drawer focus management stays correct.
        requestAnimationFrame(() => this.openCartDrawer());
      })
      .catch((error) => {
        this.resetAddButtonLoading();
        if (error?.name !== 'AbortError') console.warn('[shoppable-image-grid] Cart update rejected:', error);
      });
  };

  handleDialogClose = () => {
    this.refs.content.replaceChildren();
    this.variants = null;

    if (this.activeTrigger?.isConnected) this.activeTrigger.focus();
    this.activeTrigger = null;
  };

  /** @param {HTMLElement} trigger */
  openProduct(trigger) {
    const template = trigger.parentElement?.querySelector(selectors.template);
    if (!(template instanceof HTMLTemplateElement)) return;

    this.refs.content.replaceChildren(template.content.cloneNode(true));
    this.cacheDefaultImage();
    this.variants = this.getVariants();
    this.activeTrigger = trigger;

    this.refs.dialog.showModal();
    this.refs.closeButton.focus();
  }

  closeDialog() {
    if (this.refs.dialog.open) this.refs.dialog.close();
  }

  openCartDrawer() {
    /** @type {HTMLElement & { open?: () => void } | null} */
    const drawer = document.querySelector('theme-drawer#cart-drawer');

    if (drawer?.open) {
      drawer.open();
    } else {
      window.location.href = window.Theme?.routes?.cart_url || '/cart';
    }
  }

  selectedOptionsIncludeBonusTrigger() {
    const product = this.refs.content.querySelector(selectors.product);
    if (!(product instanceof HTMLElement)) return false;

    // Hiring-test rule: any Black + Medium selection also adds Soft Winter Jacket.
    const selectedOptions = this.getSelectedOptions(product).map((option) => option?.toLowerCase());
    return selectedOptions.includes(bonusColorValue) && selectedOptions.some((option) => bonusSizeValues.includes(option));
  }

  async addBonusProduct() {
    const bonusVariantId = this.dataset.bonusVariantId;
    if (!bonusVariantId) return;

    const formData = new FormData();
    formData.set('id', bonusVariantId);
    formData.set('quantity', '1');

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionIds = [];
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) sectionIds.push(item.dataset.sectionId);
    });
    if (sectionIds.length > 0) formData.set('sections', sectionIds.join(','));

    const deferredEventPromise = CartLinesUpdateEvent.createPromise();

    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: [{ merchandiseId: bonusVariantId, quantity: 1 }],
        promise: deferredEventPromise.promise,
      })
    );

    const response = await fetch(window.Theme?.routes?.cart_add_url || '/cart/add.js', {
      method: 'POST',
      headers: {
        Accept: 'text/html',
      },
      credentials: 'same-origin',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || data.status) {
      deferredEventPromise.reject(data);
      console.warn('[shoppable-image-grid] Bonus product add failed:', data.status || response.status);
      return;
    }

    const cart = await this.fetchCart();
    deferredEventPromise.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        items: cart.items,
        sections: data.sections,
        source: 'shoppable-image-grid',
        sourceId: this.id,
        didError: false,
      },
    });
  }

  async fetchCart() {
    const response = await fetch(`${window.Theme?.routes?.cart_url || '/cart'}.json`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });

    if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status}`);
    return response.json();
  }

  /** @param {HTMLButtonElement} button @param {boolean} isLoading */
  setAddButtonLoading(button, isLoading) {
    button.toggleAttribute('aria-busy', isLoading);
    button.classList.toggle('shoppable-grid__add-button--loading', isLoading);
  }

  resetAddButtonLoading() {
    const button = this.refs.content.querySelector('.shoppable-grid__add-button--loading');
    if (button instanceof HTMLButtonElement) this.setAddButtonLoading(button, false);
  }

  cacheDefaultImage() {
    const image = this.refs.content.querySelector(selectors.image);
    if (!(image instanceof HTMLImageElement)) return;

    image.dataset.defaultSrc = image.src;
    image.dataset.defaultSrcset = image.srcset;
  }

  /** @returns {ShoppableVariant[]} */
  getVariants() {
    const variantsElement = this.refs.content.querySelector(selectors.variants);
    if (!variantsElement?.textContent) return [];

    try {
      return JSON.parse(variantsElement.textContent);
    } catch (error) {
      console.warn('[shoppable-image-grid] Invalid variant data:', error);
      return [];
    }
  }

  /** @param {HTMLElement} product */
  updateProductVariant(product) {
    const selectedOptions = this.getSelectedOptions(product);
    const variant = this.variants?.find((item) =>
      item.options.every((option, index) => option === selectedOptions[index])
    );

    this.updateVariantInput(product, variant);
    this.updatePrice(product, variant);
    this.updateImage(product, variant);
    this.updateButton(product, variant);
  }

  /** @param {HTMLSelectElement | HTMLInputElement} control */
  updateDropdownLabel(control) {
    const dropdown = control.closest(selectors.dropdown);
    if (!(dropdown instanceof HTMLDetailsElement)) return;

    const label = dropdown.querySelector(selectors.selectedText);
    if (label) label.textContent = control.value;

    dropdown.dataset.shoppableHasSelection = 'true';
    dropdown.open = false;
  }

  /** @param {HTMLElement} product */
  getSelectedOptions(product) {
    /** @type {string[]} */
    const selectedOptions = [];
    const optionGroups = product.querySelectorAll(selectors.optionGroup);

    for (const group of optionGroups) {
      if (!(group instanceof HTMLElement)) continue;

      const optionIndex = Number(group.dataset.shoppableOptionIndex);
      const control = group.querySelector('select, input[type="radio"]:checked');
      if (!Number.isInteger(optionIndex) || !this.isOptionControl(control)) continue;

      selectedOptions[optionIndex] = control.value;
    }

    return selectedOptions;
  }

  /** @param {EventTarget | null} target */
  isOptionControl(target) {
    return (
      (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) &&
      target.matches(selectors.optionControl)
    );
  }

  /** @param {Element} target */
  getClickedOptionControl(target) {
    if (this.isOptionControl(target)) return target;

    const optionLabel = target.closest('label');
    const control = optionLabel?.querySelector(selectors.optionControl);
    return this.isOptionControl(control) ? control : null;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateVariantInput(product, variant) {
    const variantInput = product.querySelector(selectors.variantInput);
    if (variantInput instanceof HTMLInputElement) variantInput.value = variant?.id?.toString() || '';
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updatePrice(product, variant) {
    const price = product.querySelector(selectors.price);
    if (price && variant?.price) price.textContent = variant.price;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateImage(product, variant) {
    const image = product.querySelector(selectors.image);
    if (!(image instanceof HTMLImageElement)) return;

    image.src = variant?.image || image.dataset.defaultSrc || image.src;
    image.srcset = variant?.image || image.dataset.defaultSrcset || image.srcset;
  }

  /** @param {HTMLElement} product @param {ShoppableVariant | undefined} variant */
  updateButton(product, variant) {
    const button = product.querySelector('[ref="addToCartButton"]');
    if (!(button instanceof HTMLButtonElement)) return;

    button.disabled = !variant?.available;
    button.toggleAttribute('aria-disabled', !variant?.available);
  }
}

if (!customElements.get('shoppable-image-grid')) {
  customElements.define('shoppable-image-grid', ShoppableImageGrid);
}
